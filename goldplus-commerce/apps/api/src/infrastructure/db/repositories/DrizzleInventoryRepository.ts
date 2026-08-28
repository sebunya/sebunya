import { db } from '../client';
import { products } from '../schema/products';
import { orders } from '../schema/commerce';
import { inventoryReservations } from '../schema/inventory';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  InventoryPolicy,
  DEFAULT_INVENTORY_POLICY,
  parseInventoryPolicy,
  isRetryableDatabaseError,
  ReservationLineRequest,
  ReservationLineOutcome,
  ReservationOutcome,
  summariseReservation,
  computeAvailable,
  isLowStock,
} from '../../../domain/inventory/Inventory';
import { IInventoryRepository, AvailabilityRow, ReservationStatusSummary } from '../../../application/ports/IInventoryRepository';

/**
 * Bounded retry for transactions that lost a race they can win on a second
 * attempt (deadlock, serialization failure, lock timeout).
 *
 * Retrying is safe here precisely because the operation is idempotent: the
 * unique (order_id, product_id) index means a retry that follows a commit we did
 * not observe collapses onto the existing reservation rather than doubling it.
 *
 * Bounded, and small: a deadlock resolves on the next attempt or it is not a
 * deadlock. Unbounded retry against a genuinely saturated database converts a
 * slow checkout into an outage.
 */
const MAX_TRANSACTION_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 25;

export async function withTransactionRetry<T>(
  operation: () => Promise<T>,
  opts: {
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
    onRetry?: (attempt: number, error: unknown) => void;
    onExhausted?: (error: unknown) => void;
  } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? MAX_TRANSACTION_ATTEMPTS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableDatabaseError(error) || attempt === maxAttempts - 1) break;
      opts.onRetry?.(attempt + 1, error);
      // Jittered, for the same reason the outbox backoff is jittered: two
      // transactions that deadlocked against each other must not retry in step
      // and deadlock again.
      await sleep(Math.round(RETRY_BASE_DELAY_MS * 2 ** attempt * (0.5 + random() * 0.5)));
    }
  }
  if (isRetryableDatabaseError(lastError)) opts.onExhausted?.(lastError);
  throw lastError;
}

export class DrizzleInventoryRepository implements IInventoryRepository {
  /**
   * Sets on-hand stock without a read-then-write window.
   *
   * The admin path previously read availability, validated against it, then
   * issued an unconditional UPDATE. A checkout reserving the last units between
   * the read and the write slipped straight through the validation, because the
   * value it was checked against was already stale. The database constraint
   * caught it — as a raw 500.
   *
   * This is a single conditional UPDATE whose WHERE clause carries the
   * invariant, so the check and the write are the same atomic statement. Zero
   * rows updated means the condition did not hold at write time; the caller
   * re-reads to report why. The constraint remains the final authority.
   */
  async setStockQuantity(
    productId: string,
    newStock: number,
  ): Promise<{ applied: boolean; reserved: number; stock: number } | null> {
    return withTransactionRetry(async () =>
      db.transaction(async (tx) => {
        const updated = await tx
          .update(products)
          // The same rule the adjust path applies; the two had diverged, so a
          // quantity of 0 left stock_status 'in_stock' and the in-stock filter
          // kept listing a product its own card showed as out of stock.
          .set({ stockQuantity: newStock, stockStatus: sql`case when ${newStock} <= 0 then 'out_of_stock' else 'in_stock' end` })
          .where(and(eq(products.id, productId), sql`${products.reservedQuantity} <= ${newStock}`))
          .returning({ stock: products.stockQuantity, reserved: products.reservedQuantity });

        if (updated.length === 1) {
          return { applied: true, reserved: updated[0].reserved, stock: updated[0].stock };
        }

        // Nothing changed: either the product is gone or the invariant blocked
        // it. Re-read inside the same transaction to say which, authoritatively
        // rather than from the caller's stale pre-read.
        const current = await tx
          .select({ stock: products.stockQuantity, reserved: products.reservedQuantity })
          .from(products)
          .where(eq(products.id, productId));
        if (current.length === 0) return null;
        return { applied: false, reserved: current[0].reserved, stock: current[0].stock };
      }),
    );
  }

  async reserveForOrder(orderId: string, lines: ReservationLineRequest[]): Promise<ReservationOutcome> {
    return withTransactionRetry(() => this.reserveOnce(orderId, lines));
  }

  private async reserveOnce(orderId: string, lines: ReservationLineRequest[]): Promise<ReservationOutcome> {
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
        // Replay must classify identically to the original attempt, so the
        // policies are re-read rather than assumed.
        const policyRows = await tx
          .select({ id: products.id, policy: products.inventoryPolicy })
          .from(products)
          .where(inArray(products.id, existing.map((r) => r.productId)));
        const policyById = new Map(policyRows.map((r) => [r.id, parseInventoryPolicy(r.policy)]));
        const outcomeLines: ReservationLineOutcome[] = existing.map((r) => ({
          productId: r.productId,
          requested: r.requestedQuantity,
          reserved: r.reservedQuantity,
          shortfall: Math.max(0, r.requestedQuantity - r.reservedQuantity),
          policy: policyById.get(r.productId) ?? DEFAULT_INVENTORY_POLICY,
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
      // With ORDER BY, the LockRows node sits above a Sort and every
      // transaction takes the locks in one global id order, so the cycle cannot
      // form. A deadlock that does occur is now retried by withTransactionRetry
      // and, if it survives that, surfaces as RETRYABLE_FAILURE — it is never
      // laundered into an ordinary backorder.
      const sortedIds = [...productIds].sort();
      const rows = await tx
        .select({
          id: products.id,
          stock: products.stockQuantity,
          reserved: products.reservedQuantity,
          policy: products.inventoryPolicy,
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
      // A NON_STOCK_ITEM has no stock to hold, so it never blocks feasibility.
      const policyOf = (productId: string): InventoryPolicy =>
        parseInventoryPolicy(byId.get(productId)?.policy);

      const feasible = sortedIds.every((productId) => {
        if (policyOf(productId) === 'NON_STOCK_ITEM') return true;
        const requested = requestByProduct.get(productId)!;
        const row = byId.get(productId);
        if (!row) return false;
        return computeAvailable(row.stock, row.reserved) >= requested;
      });

      const outcomeLines: ReservationLineOutcome[] = [];
      for (const productId of sortedIds) {
        const requested = requestByProduct.get(productId)!;
        const policy = policyOf(productId);
        const reserved = feasible && policy !== 'NON_STOCK_ITEM' ? requested : 0;
        if (feasible && policy !== 'NON_STOCK_ITEM') {
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
        outcomeLines.push({
          productId,
          requested,
          reserved,
          shortfall: policy === 'NON_STOCK_ITEM' ? 0 : requested - reserved,
          policy,
        });
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
      // The order's own denormalised state mirrors the ledger IN THE SAME
      // TRANSACTION. Before 2026-08-06 it did not, and released orders claimed
      // RESERVED forever — on the field payment and fulfilment fail closed on.
      await this.mirrorOrderReservationState(tx, orderId, 'RELEASED');
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
      await this.mirrorOrderReservationState(tx, orderId, 'CONSUMED');
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
  /**
   * Mirrors the ledger outcome onto the order's denormalised state, inside the
   * caller's transaction. NEVER touches lifecycle `status` — that belongs
   * exclusively to OrderTransitionService — only `reservation_state`, which the
   * canonical-transition guard explicitly permits. Kept as its own method so
   * the guard's inspection window around `.update(orders)` contains nothing
   * but these two fields.
   */
  private async mirrorOrderReservationState(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    orderId: string,
    state: 'RELEASED' | 'CONSUMED',
  ): Promise<void> {
    await tx
      .update(orders)
      .set({ reservationState: state, reservationUpdatedAt: new Date() })
      .where(eq(orders.id, orderId));
  }

}
