import { and, desc, eq, gt, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '../client';
import { cartAbandonments } from '../schema/abandonment';
import { carts, cartItems } from '../schema/commerce';
import { products, productPrices } from '../schema/products';
import {
  AbandonmentCandidate,
  AbandonmentRecord,
  IAbandonmentRepository,
} from '../../../application/use-cases/abandonment/AbandonmentUseCase';

type Row = typeof cartAbandonments.$inferSelect;

const toRecord = (r: Row): AbandonmentRecord => ({
  id: r.id,
  cartId: r.cartId,
  status: r.status as AbandonmentRecord['status'],
  reason: r.reason,
  itemCount: r.itemCount,
  subtotalUgx: r.subtotalUgx,
  classifiedAt: r.classifiedAt,
  lastActivityAt: r.lastActivityAt,
});

export class DrizzleAbandonmentRepository implements IAbandonmentRepository {
  async findNewlyAbandoned(staleBefore: Date, limit: number): Promise<AbandonmentCandidate[]> {
    // Priced the same way the cart reads price: retail price-book entry first,
    // catalogue display price as fallback — the recorded subtotal matches what the
    // shopper saw, not a re-derivation.
    const rows = await db
      .select({
        cartId: carts.id,
        ownerKind: carts.ownerKind,
        ownerId: carts.ownerId,
        lastActivityAt: carts.updatedAt,
        expiresAt: carts.expiresAt,
        itemCount: sql<number>`count(${cartItems.productId})::int`,
        subtotalUgx: sql<number>`coalesce(sum(coalesce(${productPrices.retailPrice}, ${products.priceUgx}, 0) * ${cartItems.quantity}), 0)::bigint`,
      })
      .from(carts)
      .innerJoin(cartItems, eq(cartItems.cartId, carts.id))
      .innerJoin(products, eq(products.id, cartItems.productId))
      .leftJoin(productPrices, eq(productPrices.productId, cartItems.productId))
      .where(
        and(
          lt(carts.updatedAt, staleBefore),
          sql`not exists (select 1 from ${cartAbandonments} ca where ca.cart_id = ${carts.id} and ca.status = 'OPEN')`,
        ),
      )
      .groupBy(carts.id, carts.ownerKind, carts.ownerId, carts.updatedAt, carts.expiresAt)
      .limit(limit);
    return rows.map((r) => ({ ...r, subtotalUgx: Number(r.subtotalUgx) }));
  }

  async createOpen(candidate: AbandonmentCandidate): Promise<AbandonmentRecord | null> {
    const [row] = await db
      .insert(cartAbandonments)
      .values({
        cartId: candidate.cartId,
        ownerKind: candidate.ownerKind,
        ownerId: candidate.ownerId,
        itemCount: candidate.itemCount,
        subtotalUgx: candidate.subtotalUgx,
        lastActivityAt: candidate.lastActivityAt,
      })
      .onConflictDoNothing()
      .returning();
    return row ? toRecord(row) : null;
  }

  async expireOverdue(now: Date): Promise<number> {
    const rows = await db
      .update(cartAbandonments)
      .set({ status: 'EXPIRED', resolvedAt: now })
      .where(
        and(
          eq(cartAbandonments.status, 'OPEN'),
          sql`exists (select 1 from ${carts} c where c.id = ${cartAbandonments.cartId} and c.expires_at is not null and c.expires_at < ${now})`,
        ),
      )
      .returning({ id: cartAbandonments.id });
    return rows.length;
  }

  async summary() {
    const [row] = await db
      .select({
        open: sql<number>`count(*) filter (where status = 'OPEN')::int`,
        expired: sql<number>`count(*) filter (where status = 'EXPIRED')::int`,
        recovered: sql<number>`count(*) filter (where status = 'RECOVERED')::int`,
        last24h: sql<number>`count(*) filter (where classified_at > now() - interval '24 hours')::int`,
      })
      .from(cartAbandonments);
    return row ?? { open: 0, expired: 0, recovered: 0, last24h: 0 };
  }

  async recent(limit: number): Promise<AbandonmentRecord[]> {
    const rows = await db.select().from(cartAbandonments).orderBy(desc(cartAbandonments.classifiedAt)).limit(limit);
    return rows.map(toRecord);
  }
}
