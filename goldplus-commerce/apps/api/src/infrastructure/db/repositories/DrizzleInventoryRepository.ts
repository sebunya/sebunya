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
import { IInventoryRepository, AvailabilityRow, ReservationStatusSummary } from '../../../application/ports/IInventoryRepository';

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

      // Lock every product row so concurrent checkouts cannot oversell.
      //
      // The ORDER BY is load-bearing, not cosmetic. Sorting the id array in
      // JavaScript does NOT control the order PostgreSQL takes the locks in:
      // without an ORDER BY the LockRows node sits directly above the scan and
      // locks in whatever order that scan emits, which varies with the chosen
      // plan. Two concurrent multi-line orders touching the same products in
      // opposite scan orders then deadlock, and PostgreSQL aborts one of them.
      //
      // That abort is not a mere retry nuisance here: reservation is
      // best-effort by contract (a failure must not fail the order), so the
      // losing order proceeds with NO stock held and the same units can be sold
      // again — the exact oversell this lock exists to prevent. With ORDER BY,
      // the LockRows node sits above a Sort and every transaction takes the
      // locks in one global id order, so the cycle cannot form.
      const sortedIds = [...productIds].sort();
      const rows = await tx
        .select({
          id: products.id,
          stock: products.stockQuantity,
          reserved: products.reservedQuantity,
        })
        .from(products)
        .where(inArray(products.id, sortedIds))
        .orderBy(products.id)
        .for('update');
      const byId = new Map(rows.map((r) => [r.id, r]));

      // All-or-nothing: a normal order reserves every line fully or reserves
      // nothing. Any line that cannot be fully satisfied (missing product or
      // insufficient available stock) makes the whole reservation a backorder,
      // and NO stock is held — the order is never silently oversold.
      const feasible = sortedIds.every((productId) => {
        const requested = requestByProduct.get(productId)!;
        const row = byId.get(productId);
        if (!row) return false;
        return computeAvailable(row.stock, row.reserved) >= requested;
      });

      const outcomeLines: ReservationLineOutcome[] = [];
      for (const productId of sortedIds) {
        const requested = requestByProduct.get(productId)!;
        const reserved = feasible ? requested : 0;
        if (feasible) {
          await tx
            .update(products)
            .set({ reservedQuantity: sql`${products.reservedQuantity} + ${reserved}` })
            .where(eq(products.id, productId));
          await tx.insert(inventoryReservations).values({
            orderId,
            productId,
            requestedQuantity: requested,
            reservedQuantity: reserved,
            status: 'reserved',
          });
        }
        outcomeLines.push({ productId, requested, reserved, shortfall: requested - reserved });
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

  async summariseReservations(orderId: string): Promise<ReservationStatusSummary> {
    const rows = await db
      .select({ status: inventoryReservations.status })
      .from(inventoryReservations)
      .where(eq(inventoryReservations.orderId, orderId));
    const summary = { total: rows.length, reserved: 0, consumed: 0, released: 0 };
    for (const r of rows) {
      if (r.status === 'reserved') summary.reserved += 1;
      else if (r.status === 'consumed') summary.consumed += 1;
      else if (r.status === 'released') summary.released += 1;
    }
    return { ...summary, fullyConsumed: summary.total > 0 && summary.reserved === 0 };
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
