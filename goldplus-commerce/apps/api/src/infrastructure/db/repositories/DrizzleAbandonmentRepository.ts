import { and, desc, eq, gt, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '../client';
import { cartAbandonments } from '../schema/abandonment';
import type { BasketReminderCandidate, BasketReminderRefusal, IBasketReminderCandidates } from '../../../application/use-cases/abandonment/SendBasketRemindersUseCase';
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
  reminderOutcome: r.reminderOutcome ?? null,
});

/**
 * How far a basket's updated_at may sit past the recorded last activity and still be "unchanged". last_activity_at went
 * through drizzle, which binds a Date in whole seconds, while a cart touched by SQL now() keeps microseconds: compared
 * exactly, an untouched basket could read as changed (no reminder, and closed as RESUMED). A real return comes at
 * least ABANDONMENT_STALE_HOURS after the last activity, so a minute of slack can never hide one.
 */
const UNCHANGED_SLACK = sql`interval '1 minute'`;

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

  /**
   * 0210: baskets due a reminder, at most one per customer (their newest), with the names and count of what can still
   * be bought, worked out now. Skipped (2026-10-29 review): a basket changed since it was classified (the shopper is
   * back; the hourly scan closes that row), a customer who has ordered since, and anything inside the weekly cap.
   * itemCount 0 = nothing purchasable left (the caller records it, nothing is sent).
   */
  async findDue(input: { classifiedBefore: Date; classifiedAfter: Date; noReminderSince: Date; limit: number }): Promise<BasketReminderCandidate[]> {
    // Each customer's newest basket (distinct on), then the longest-waiting first: ordered by owner alone, a batch
    // limit would always serve the same customers first.
    const rows = (await db.execute(sql`
      select d."abandonmentId", d."cartId", d."userId", d."subtotalUgx", d."itemCount", d."itemNames" from (
      select distinct on (a.owner_id) a.id as "abandonmentId", a.cart_id as "cartId", a.owner_id as "userId", a.subtotal_ugx as "subtotalUgx",
             coalesce(live.n, 0) as "itemCount", coalesce(live.names, '{}') as "itemNames", a.classified_at as "classifiedAt"
      from cart_abandonments a
      join carts c on c.id = a.cart_id
      left join lateral (
        select count(*)::int as n, (array_agg(p.name order by ci.quantity desc, p.name))[1:2] as names
        from cart_items ci join products p on p.id = ci.product_id
        where ci.cart_id = a.cart_id and p.active = true and p.approval_status = 'approved'
      ) live on true
      where a.status = 'OPEN' and a.owner_kind = 'USER' and a.owner_id is not null and a.reminded_at is null
        and a.classified_at <= ${input.classifiedBefore} and a.classified_at >= ${input.classifiedAfter}
        and c.updated_at <= a.last_activity_at + ${UNCHANGED_SLACK}
        and not exists (select 1 from orders o where o.user_id::text = a.owner_id and o.created_at > a.last_activity_at)
        and not exists (select 1 from cart_abandonments b where b.owner_id = a.owner_id and b.reminder_outcome in ('sent', 'sending') and b.reminded_at > ${input.noReminderSince})
      order by a.owner_id, a.classified_at desc
      ) d order by d."classifiedAt", d."abandonmentId"
      limit ${input.limit}`)) as unknown as Array<{ abandonmentId: string; cartId: string; userId: string; itemCount: number; subtotalUgx: number | string; itemNames: string[] | null }>;
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []) as typeof rows;
    return list.map((r) => ({
      abandonmentId: String(r.abandonmentId), cartId: String(r.cartId), userId: String(r.userId),
      itemCount: Number(r.itemCount), subtotalUgx: Number(r.subtotalUgx), itemNames: Array.isArray(r.itemNames) ? r.itemNames.map(String) : [],
    }));
  }

  /**
   * Takes the basket for one text, atomically per customer: under a per-customer lock (every replica), only if it is
   * still untouched and the customer has had no reminder inside the cap. Two baskets of one customer, or two replicas
   * reading the same batch, can no longer both pass the cap read once at the top of the batch.
   */
  async claimForReminder(input: { abandonmentId: string; userId: string; now: Date; noReminderSince: Date }): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`basket-reminder:${input.userId}`}, 0))`);
      const r = (await tx.execute(sql`update cart_abandonments set reminded_at = ${input.now}, reminder_outcome = 'sending'
        where id = ${input.abandonmentId}::uuid and reminded_at is null and status = 'OPEN'
          and exists (select 1 from carts c where c.id = cart_abandonments.cart_id and c.updated_at <= cart_abandonments.last_activity_at + ${UNCHANGED_SLACK})
          and not exists (select 1 from cart_abandonments b where b.owner_id = ${input.userId} and b.reminder_outcome in ('sent', 'sending') and b.reminded_at > ${input.noReminderSince})
        returning id`)) as unknown as unknown[] | { rows?: unknown[] };
      return (Array.isArray(r) ? r : (r.rows ?? [])).length > 0;
    });
  }

  /** The claimed basket's final outcome ('sent' once queued, 'failed' when queueing threw: never retried, never spam). */
  async settleReminder(abandonmentId: string, outcome: 'sent' | 'failed'): Promise<void> {
    await db.update(cartAbandonments).set({ reminderOutcome: outcome }).where(and(eq(cartAbandonments.id, abandonmentId), eq(cartAbandonments.reminderOutcome, 'sending')));
  }

  async markReminded(abandonmentId: string, now: Date, outcome: BasketReminderRefusal): Promise<void> {
    await db.update(cartAbandonments).set({ remindedAt: now, reminderOutcome: outcome }).where(and(eq(cartAbandonments.id, abandonmentId), sql`${cartAbandonments.remindedAt} is null`));
  }

  /**
   * OPEN rows whose basket changed after it was classified: the shopper came back, so that idle period is over. Closed
   * as RESUMED (the unique index covers OPEN rows only), so the next idle period gets a row of its own. Without this a
   * row stayed OPEN for the basket's whole 180-day life: no new reminder, and a stale one could fire minutes after the
   * shopper returned (2026-10-29 review).
   */
  async resumeChanged(now: Date): Promise<number> {
    const r = (await db.execute(sql`update cart_abandonments a set status = 'RESUMED', resolved_at = ${now}
      from carts c where c.id = a.cart_id and a.status = 'OPEN' and c.updated_at > a.last_activity_at + ${UNCHANGED_SLACK}
      returning a.id`)) as unknown as unknown[] | { rows?: unknown[] };
    return (Array.isArray(r) ? r : (r.rows ?? [])).length;
  }

  async summary() {
    const [row] = await db
      .select({
        open: sql<number>`count(*) filter (where status = 'OPEN')::int`,
        expired: sql<number>`count(*) filter (where status = 'EXPIRED')::int`,
        recovered: sql<number>`count(*) filter (where status = 'RECOVERED')::int`,
        resumed: sql<number>`count(*) filter (where status = 'RESUMED')::int`,
        remindersSent7d: sql<number>`count(*) filter (where reminder_outcome = 'sent' and reminded_at > now() - interval '7 days')::int`,
        last24h: sql<number>`count(*) filter (where classified_at > now() - interval '24 hours')::int`,
      })
      .from(cartAbandonments);
    return row ?? { open: 0, expired: 0, recovered: 0, resumed: 0, remindersSent7d: 0, last24h: 0 };
  }

  async recent(limit: number): Promise<AbandonmentRecord[]> {
    const rows = await db.select().from(cartAbandonments).orderBy(desc(cartAbandonments.classifiedAt)).limit(limit);
    return rows.map(toRecord);
  }
}
