import { and, desc, eq, gt, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '../client';
import { cartAbandonments } from '../schema/abandonment';
import type { BasketReminderCandidate, IBasketReminderCandidates } from '../../../application/use-cases/abandonment/SendBasketRemindersUseCase';
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

export class DrizzleAbandonmentRepository implements IAbandonmentRepository, IBasketReminderCandidates {
  async findNewlyAbandoned(staleBefore: Date, limit: number, now: Date = new Date()): Promise<AbandonmentCandidate[]> {
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
          // An expired cart cannot be recovered, so it is not "newly abandoned"
          // — classifying it again only manufactured a second lifecycle for the
          // same cart (and, before 0129, the collision that stalled every expiry).
          sql`(${carts.expiresAt} is null or ${carts.expiresAt} > ${now})`,
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

  /** 0210: baskets due a reminder, with up to two product names each (biggest line first). */
  async findDue(input: { classifiedBefore: Date; classifiedAfter: Date; noReminderSince: Date; limit: number }): Promise<BasketReminderCandidate[]> {
    const rows = (await db.execute(sql`
      select a.id as "abandonmentId", a.cart_id as "cartId", a.owner_id as "userId", a.item_count as "itemCount", a.subtotal_ugx as "subtotalUgx",
             coalesce((select array_agg(p.name order by ci.quantity desc, p.name) from (
                         select ci.product_id, ci.quantity from cart_items ci where ci.cart_id = a.cart_id order by ci.quantity desc limit 2) ci
                       join products p on p.id = ci.product_id), '{}') as "itemNames"
      from cart_abandonments a
      where a.status = 'OPEN' and a.owner_kind = 'USER' and a.owner_id is not null and a.reminded_at is null
        and a.classified_at <= ${input.classifiedBefore} and a.classified_at >= ${input.classifiedAfter}
        and exists (select 1 from cart_items ci where ci.cart_id = a.cart_id)
        and not exists (select 1 from cart_abandonments b where b.owner_id = a.owner_id and b.reminder_outcome = 'sent' and b.reminded_at > ${input.noReminderSince})
      order by a.classified_at
      limit ${input.limit}`)) as unknown as Array<{ abandonmentId: string; cartId: string; userId: string; itemCount: number; subtotalUgx: number | string; itemNames: string[] | null }>;
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []) as typeof rows;
    return list.map((r) => ({
      abandonmentId: String(r.abandonmentId), cartId: String(r.cartId), userId: String(r.userId),
      itemCount: Number(r.itemCount), subtotalUgx: Number(r.subtotalUgx), itemNames: Array.isArray(r.itemNames) ? r.itemNames.map(String) : [],
    }));
  }

  async markReminded(abandonmentId: string, now: Date, outcome: 'sent' | 'not_opted_in' | 'no_phone' | 'suppressed'): Promise<void> {
    await db.update(cartAbandonments).set({ remindedAt: now, reminderOutcome: outcome }).where(and(eq(cartAbandonments.id, abandonmentId), sql`${cartAbandonments.remindedAt} is null`));
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
