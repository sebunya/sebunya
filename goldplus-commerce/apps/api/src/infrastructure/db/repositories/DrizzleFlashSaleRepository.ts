import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../client';
import { flashSaleItems, flashSaleReservations, flashSales } from '../schema/flashSales';
import { products } from '../schema/products';

export type FlashReserveResult =
  | { ok: true; token: string; duplicate: boolean }
  | { ok: false; reason: 'SOLD_OUT' | 'PER_CUSTOMER_LIMIT' | 'SALE_NOT_LIVE' };

/**
 * U5 — flash-sale allocation on PostgreSQL (the durable truth; Redis is a
 * high-rate front reconciled here). Exactly-N allocation under concurrency is a
 * CONDITIONAL decrement on units_reserved; per-customer limits are enforced under
 * the same row lock so a second session cannot bypass them.
 */
export class DrizzleFlashSaleRepository {
  /** Admin overview: recent sales with allocation roll-up across their items. */
  async adminList(limit = 50): Promise<Array<{ id: string; name: string; status: string; startsAt: Date; endsAt: Date; unitsAllocated: number; unitsSold: number; unitsReserved: number }>> {
    const rows = await db
      .select({
        id: flashSales.id, name: flashSales.name, status: flashSales.status, startsAt: flashSales.startsAt, endsAt: flashSales.endsAt,
        unitsAllocated: sql<number>`coalesce(sum(${flashSaleItems.unitsAllocated}),0)::int`,
        unitsSold: sql<number>`coalesce(sum(${flashSaleItems.unitsSold}),0)::int`,
        unitsReserved: sql<number>`coalesce(sum(${flashSaleItems.unitsReserved}),0)::int`,
      })
      .from(flashSales)
      .leftJoin(flashSaleItems, eq(flashSaleItems.flashSaleId, flashSales.id))
      .groupBy(flashSales.id)
      .orderBy(desc(flashSales.startsAt))
      .limit(Math.min(limit, 200));
    return rows;
  }

  async reserve(input: {
    flashSaleItemId: string;
    customerIdentityHash: string;
    idempotencyKey: string;
    reservationToken: string;
    quantity?: number;
    perCustomerLimit?: number | null;
    ttlSeconds: number;
    now: Date;
  }): Promise<FlashReserveResult> {
    const quantity = input.quantity ?? 1;
    return db.transaction(async (tx): Promise<FlashReserveResult> => {
      // Idempotent replay.
      const existing = await tx.select({ token: flashSaleReservations.reservationToken }).from(flashSaleReservations).where(eq(flashSaleReservations.idempotencyKey, input.idempotencyKey)).limit(1);
      if (existing.length) return { ok: true, token: existing[0].token, duplicate: true };

      // Atomic gate (AC2): admit only while sold+reserved+qty stays within allocation.
      // The UPDATE locks the item row until commit, serialising all racers.
      const gate = await tx
        .update(flashSaleItems)
        .set({ unitsReserved: sql`${flashSaleItems.unitsReserved} + ${quantity}` })
        .where(sql`${flashSaleItems.id} = ${input.flashSaleItemId}
          AND ${flashSaleItems.unitsSold} + ${flashSaleItems.unitsReserved} + ${quantity} <= ${flashSaleItems.unitsAllocated}`)
        .returning({ id: flashSaleItems.id });
      if (gate.length === 0) throw new FlashGate('SOLD_OUT');

      // Per-customer limit (AC4): the item row is now locked, so this count is
      // race-free against concurrent same-customer sessions.
      if (input.perCustomerLimit != null) {
        const [held] = await tx
          .select({ n: sql<number>`coalesce(sum(${flashSaleReservations.quantity}), 0)::int` })
          .from(flashSaleReservations)
          .where(and(eq(flashSaleReservations.flashSaleItemId, input.flashSaleItemId), eq(flashSaleReservations.customerIdentityHash, input.customerIdentityHash), inArray(flashSaleReservations.status, ['reserved', 'confirmed'])));
        if ((held?.n ?? 0) + quantity > input.perCustomerLimit) throw new FlashGate('PER_CUSTOMER_LIMIT');
      }

      await tx.insert(flashSaleReservations).values({
        flashSaleItemId: input.flashSaleItemId,
        customerIdentityHash: input.customerIdentityHash,
        reservationToken: input.reservationToken,
        idempotencyKey: input.idempotencyKey,
        quantity,
        expiresAt: new Date(input.now.getTime() + input.ttlSeconds * 1000),
      });
      return { ok: true, token: input.reservationToken, duplicate: false };
    }).catch((err) => {
      if (err instanceof FlashGate) return { ok: false, reason: err.reason } as FlashReserveResult;
      throw err;
    });
  }

  /** AC6 — expire reservations past their TTL and return their units to the pool. */
  async expireReservations(now: Date): Promise<{ expired: number }> {
    return db.transaction(async (tx) => {
      const due = await tx
        .select({ id: flashSaleReservations.id, itemId: flashSaleReservations.flashSaleItemId, quantity: flashSaleReservations.quantity })
        .from(flashSaleReservations)
        .where(and(eq(flashSaleReservations.status, 'reserved'), sql`${flashSaleReservations.expiresAt} <= ${now}`))
        .for('update');
      for (const r of due) {
        await tx.update(flashSaleReservations).set({ status: 'expired', releasedAt: now }).where(eq(flashSaleReservations.id, r.id));
        await tx.update(flashSaleItems).set({ unitsReserved: sql`GREATEST(${flashSaleItems.unitsReserved} - ${r.quantity}, 0)` }).where(eq(flashSaleItems.id, r.itemId));
      }
      return { expired: due.length };
    });
  }

  /** AC5 — cancel a sale: release active reservations, restore UNSOLD allocation to
   * general stock, and set the sale cancelled — all in ONE transaction so price
   * (via sale status) and inventory revert together. Idempotent. */
  async cancelSale(flashSaleId: string, now: Date): Promise<{ cancelled: boolean; restoredUnits: number }> {
    return db.transaction(async (tx) => {
      const [sale] = await tx.select({ status: flashSales.status }).from(flashSales).where(eq(flashSales.id, flashSaleId)).for('update').limit(1);
      if (!sale || sale.status === 'cancelled') return { cancelled: false, restoredUnits: 0 };

      const items = await tx.select().from(flashSaleItems).where(eq(flashSaleItems.flashSaleId, flashSaleId)).for('update');
      let restoredUnits = 0;
      for (const item of items) {
        // Release the item's active reservations.
        await tx.update(flashSaleReservations).set({ status: 'released', releasedAt: now }).where(and(eq(flashSaleReservations.flashSaleItemId, item.id), eq(flashSaleReservations.status, 'reserved')));
        const unsold = item.unitsAllocated - item.unitsSold;
        if (unsold > 0) {
          // Return unsold allocation to general stock.
          await tx.update(products).set({ stockQuantity: sql`${products.stockQuantity} + ${unsold}` }).where(eq(products.id, item.productId));
          restoredUnits += unsold;
        }
        await tx.update(flashSaleItems).set({ unitsReserved: 0 }).where(eq(flashSaleItems.id, item.id));
      }
      await tx.update(flashSales).set({ status: 'cancelled', updatedAt: now }).where(eq(flashSales.id, flashSaleId));
      return { cancelled: true, restoredUnits };
    });
  }
}

class FlashGate extends Error {
  constructor(public readonly reason: 'SOLD_OUT' | 'PER_CUSTOMER_LIMIT' | 'SALE_NOT_LIVE') {
    super(reason);
  }
}
