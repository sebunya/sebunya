import { db } from '../client';
import { products } from '../schema/products';
import { inventoryReservations } from '../schema/inventory';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  ReservationLineRequest,
  ReservationLineOutcome,
  ReservationOutcome,
  summariseReservation,
  computeAvailable,
  isLowStock,
} from '../../../domain/inventory/Inventory';
import { IInventoryRepository, AvailabilityRow } from '../../../application/ports/IInventoryRepository';

export class DrizzleInventoryRepository implements IInventoryRepository {
  async reserveForOrder(orderId: string, lines: ReservationLineRequest[]): Promise<ReservationOutcome> {
    // Collapse duplicate product lines defensively.
    const requestByProduct = new Map<string, number>();
    for (const l of lines) {
      if (l.quantity > 0) requestByProduct.set(l.productId, (requestByProduct.get(l.productId) ?? 0) + l.quantity);
    }
    const productIds = [...requestByProduct.keys()];
    if (productIds.length === 0) {
      return summariseReservation(orderId, [], false);
    }

    return db.transaction(async (tx) => {
      // Idempotency: if this order already has reservations, return them unchanged.
      const existing = await tx
        .select()
        .from(inventoryReservations)
        .where(eq(inventoryReservations.orderId, orderId));
      if (existing.length > 0) {
        const outcomeLines: ReservationLineOutcome[] = existing.map((r) => ({
          productId: r.productId,
          requested: r.requestedQuantity,
          reserved: r.reservedQuantity,
          shortfall: Math.max(0, r.requestedQuantity - r.reservedQuantity),
        }));
        return summariseReservation(orderId, outcomeLines, true);
      }

      // Lock the product rows so concurrent checkouts cannot oversell.
      const rows = await tx
        .select({
          id: products.id,
          stock: products.stockQuantity,
          reserved: products.reservedQuantity,
        })
        .from(products)
        .where(inArray(products.id, productIds))
        .for('update');
      const byId = new Map(rows.map((r) => [r.id, r]));

      const outcomeLines: ReservationLineOutcome[] = [];
      for (const productId of productIds) {
        const requested = requestByProduct.get(productId)!;
        const row = byId.get(productId);
        if (!row) {
          // Unknown product — reserve nothing, full backorder (truthful).
          outcomeLines.push({ productId, requested, reserved: 0, shortfall: requested });
          continue;
        }
        const available = computeAvailable(row.stock, row.reserved);
        const reserved = Math.max(0, Math.min(available, requested));
        if (reserved > 0) {
          await tx
            .update(products)
            .set({ reservedQuantity: sql`${products.reservedQuantity} + ${reserved}` })
            .where(eq(products.id, productId));
        }
        await tx.insert(inventoryReservations).values({
          orderId,
          productId,
          requestedQuantity: requested,
          reservedQuantity: reserved,
          status: 'reserved',
        });
        outcomeLines.push({ productId, requested, reserved, shortfall: Math.max(0, requested - reserved) });
      }
      return summariseReservation(orderId, outcomeLines, false);
    });
  }

  async releaseForOrder(orderId: string): Promise<{ released: boolean }> {
    return db.transaction(async (tx) => {
      const active = await tx
        .select()
        .from(inventoryReservations)
        .where(and(eq(inventoryReservations.orderId, orderId), eq(inventoryReservations.status, 'reserved')))
        .for('update');
      if (active.length === 0) return { released: false };
      for (const r of active) {
        if (r.reservedQuantity > 0) {
          await tx
            .update(products)
            .set({ reservedQuantity: sql`greatest(0, ${products.reservedQuantity} - ${r.reservedQuantity})` })
            .where(eq(products.id, r.productId));
        }
        await tx
          .update(inventoryReservations)
          .set({ status: 'released', updatedAt: new Date() })
          .where(eq(inventoryReservations.id, r.id));
      }
      return { released: true };
    });
  }

  async consumeForOrder(orderId: string): Promise<{ consumed: boolean }> {
    return db.transaction(async (tx) => {
      const active = await tx
        .select()
        .from(inventoryReservations)
        .where(and(eq(inventoryReservations.orderId, orderId), eq(inventoryReservations.status, 'reserved')))
        .for('update');
      if (active.length === 0) return { consumed: false };
      for (const r of active) {
        if (r.reservedQuantity > 0) {
          await tx
            .update(products)
            .set({
              stockQuantity: sql`greatest(0, ${products.stockQuantity} - ${r.reservedQuantity})`,
              reservedQuantity: sql`greatest(0, ${products.reservedQuantity} - ${r.reservedQuantity})`,
            })
            .where(eq(products.id, r.productId));
        }
        await tx
          .update(inventoryReservations)
          .set({ status: 'consumed', updatedAt: new Date() })
          .where(eq(inventoryReservations.id, r.id));
      }
      return { consumed: true };
    });
  }

  async getAvailability(productIds: string[]): Promise<AvailabilityRow[]> {
    if (productIds.length === 0) return [];
    const rows = await db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        stock: products.stockQuantity,
        reserved: products.reservedQuantity,
        reorder: products.reorderPoint,
      })
      .from(products)
      .where(inArray(products.id, productIds));
    return rows.map((r) => this.toAvailability(r));
  }

  async listLowStock(limit: number): Promise<AvailabilityRow[]> {
    const rows = await db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        stock: products.stockQuantity,
        reserved: products.reservedQuantity,
        reorder: products.reorderPoint,
      })
      .from(products)
      .where(
        and(
          sql`${products.reorderPoint} > 0`,
          sql`${products.stockQuantity} - ${products.reservedQuantity} <= ${products.reorderPoint}`
        )
      )
      .orderBy(sql`${products.stockQuantity} - ${products.reservedQuantity} asc`)
      .limit(limit);
    return rows.map((r) => this.toAvailability(r));
  }

  private toAvailability(r: { id: string; sku: string; name: string; stock: number; reserved: number; reorder: number }): AvailabilityRow {
    return {
      productId: r.id,
      sku: r.sku,
      name: r.name,
      stockOnHand: r.stock,
      reserved: r.reserved,
      available: computeAvailable(r.stock, r.reserved),
      reorderPoint: r.reorder,
      lowStock: isLowStock({ stockOnHand: r.stock, reserved: r.reserved, reorderPoint: r.reorder }),
    };
  }
}
