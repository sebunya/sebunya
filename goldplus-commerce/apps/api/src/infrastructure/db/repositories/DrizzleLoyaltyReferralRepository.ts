import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { LOYALTY_PAYMENT_QUALIFIES_SQL } from '../LoyaltyEarnEligibilitySql';
import { users } from '../schema/identity';
import { loyaltyReferrals } from '../schema/loyalty';
import { ILoyaltyReferralRepository } from '../../../application/use-cases/loyalty/LoyaltyGamificationUseCases';
import { friendDisplayName, type ReferralHoldReason, type ReferralShareChannel, type ReferralSource } from '../../../domain/loyalty/Referral';

type Rows<T> = T[];
const rowsOf = <T>(r: unknown): Rows<T> => r as Rows<T>;

/** The admin list and funnel (0202). */
export interface ReferralAdminRow {
  id: string; code: string; status: string; source: string; heldReason: string | null; rejectionReason: string | null;
  referrerEmail: string | null; refereeEmail: string | null; qualifyingOrderNumber: string | null;
  friendOrders: number; createdAt: string; updatedAt: string;
}

/** Unambiguous alphabet (no 0/O/1/I) for read-aloud referral codes. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  const bytes = randomBytes(6);
  let code = 'GP';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

export class DrizzleLoyaltyReferralRepository implements ILoyaltyReferralRepository {
  async getOrCreateCode(userId: string): Promise<string> {
    const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
    const existing = (row as { referralCode?: string | null } | undefined)?.referralCode;
    if (existing) return existing;
    // Retry on the (astronomically unlikely) unique collision. Only set where none is set yet: two first loads at
    // once used to each write a code, so the code on the first screen could be overwritten by the second.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      try {
        const set = await db.update(users).set({ referralCode: code })
          .where(and(eq(users.id, userId), sql`${users.referralCode} is null`)).returning({ code: users.referralCode });
        if (set[0]?.code) return set[0].code;
        const now = await db.query.users.findFirst({ where: eq(users.id, userId) });
        if (now?.referralCode) return now.referralCode;
        throw new Error('REFERRAL_CODE_USER_NOT_FOUND');
      } catch (err) {
        // A unique clash on the code is retried with another; anything else is a real failure, not hidden.
        if ((err as { code?: string })?.code === '23505') continue;
        throw err;
      }
    }
    throw new Error('REFERRAL_CODE_GENERATION_FAILED');
  }

  async findReferrerByCode(code: string): Promise<{ userId: string; phone: string | null } | null> {
    const row = await db.query.users.findFirst({ where: eq(users.referralCode, code) });
    return row ? { userId: row.id, phone: row.phone ?? null } : null;
  }

  async userPhone(userId: string): Promise<string | null> {
    const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
    return row?.phone ?? null;
  }

  async recordReferral(input: { code: string; referrerUserId: string; refereeUserId: string; source?: ReferralSource }): Promise<'recorded' | 'duplicate'> {
    const inserted = await db
      .insert(loyaltyReferrals)
      .values({ code: input.code, referrerUserId: input.referrerUserId, refereeUserId: input.refereeUserId, source: input.source ?? 'typed' })
      .onConflictDoNothing({ target: loyaltyReferrals.refereeUserId })
      .returning();
    return inserted.length > 0 ? 'recorded' : 'duplicate';
  }

  async findPendingByReferee(refereeUserId: string): Promise<{ id: string; code: string; referrerUserId: string } | null> {
    const row = await db.query.loyaltyReferrals.findFirst({
      where: sql`${loyaltyReferrals.refereeUserId} = ${refereeUserId} and ${loyaltyReferrals.status} = 'pending'`,
    });
    return row ? { id: row.id, code: row.code, referrerUserId: row.referrerUserId } : null;
  }

  async findById(id: string): Promise<{ id: string; status: string; referrerUserId: string; refereeUserId: string; qualifyingOrderId: string | null } | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const row = await db.query.loyaltyReferrals.findFirst({ where: eq(loyaltyReferrals.id, id) });
    return row ? { id: row.id, status: row.status, referrerUserId: row.referrerUserId, refereeUserId: row.refereeUserId, qualifyingOrderId: row.qualifyingOrderId ?? null } : null;
  }

  async markAwarded(id: string, referrerEntryId: string, refereeEntryId: string, qualifyingOrderId: string, decidedBy: string | null = null): Promise<void> {
    await db
      .update(loyaltyReferrals)
      .set({
        status: 'awarded',
        referrerEntryId: referrerEntryId || null,
        refereeEntryId: refereeEntryId || null,
        qualifyingOrderId,
        updatedAt: new Date(),
        ...(decidedBy ? { decidedBy, decidedAt: new Date() } : {}),
      })
      .where(eq(loyaltyReferrals.id, id));
  }

  async markHeld(id: string, reason: ReferralHoldReason, qualifyingOrderId: string): Promise<void> {
    await db.update(loyaltyReferrals)
      .set({ status: 'held', heldReason: reason, qualifyingOrderId, updatedAt: new Date() })
      .where(and(eq(loyaltyReferrals.id, id), eq(loyaltyReferrals.status, 'pending')));
  }

  async findAwardedByQualifyingOrder(orderId: string): Promise<{ id: string; referrerEntryId: string | null; refereeEntryId: string | null } | null> {
    const [row] = await db
      .select({ id: loyaltyReferrals.id, referrerEntryId: loyaltyReferrals.referrerEntryId, refereeEntryId: loyaltyReferrals.refereeEntryId })
      .from(loyaltyReferrals)
      .where(and(eq(loyaltyReferrals.qualifyingOrderId, orderId), eq(loyaltyReferrals.status, 'awarded')))
      .limit(1);
    return row ?? null;
  }

  async markRejected(id: string, reason: string, decidedBy: string | null = null): Promise<void> {
    await db
      .update(loyaltyReferrals)
      .set({ status: 'rejected', rejectionReason: reason.slice(0, 120), updatedAt: new Date(), ...(decidedBy ? { decidedBy, decidedAt: new Date() } : {}) })
      .where(eq(loyaltyReferrals.id, id));
  }

  async countAwardedForReferrer(referrerUserId: string, sinceDays: number): Promise<number> {
    const rows = (await db.execute(sql`
      select count(*)::int as n from loyalty_referrals
      where referrer_user_id = ${referrerUserId} and status = 'awarded'
        and updated_at > now() - (${sinceDays} || ' days')::interval`)) as unknown as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  }

  async countDeliveredRetailOrders(userId: string): Promise<number> {
    const rows = (await db.execute(sql`
      select count(*)::int as n from orders
      where user_id = ${userId} and ${LOYALTY_PAYMENT_QUALIFIES_SQL}
        and status in ('delivered','completed') and buyer_type = 'retail'`)) as unknown as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  }

  /** Compared on the last nine digits, so 0772…, +256772… and 256772… are one number. */
  async orderUsesReferrerPhone(orderId: string, referrerUserId: string): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/i.test(orderId) || !/^[0-9a-f-]{36}$/i.test(referrerUserId)) return false;
    const rows = (await db.execute(sql`
      with order_phone as (
        select right(regexp_replace(coalesce(customer_phone, ''), '\\D', '', 'g'), 9) as p from orders where id = ${orderId}::uuid
      ), referrer_phones as (
        select right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 9) as p from users where id = ${referrerUserId}::uuid
        union
        select right(regexp_replace(coalesce(customer_phone, ''), '\\D', '', 'g'), 9) from orders where user_id = ${referrerUserId}::uuid
      )
      select exists (
        select 1 from order_phone o join referrer_phones r on r.p = o.p where length(o.p) = 9
      ) as hit`)) as unknown as Array<{ hit: boolean }>;
    return rows[0]?.hit === true;
  }

  /**
   * Each friend this customer introduced, newest first: a short name (from the friend's latest order, never their
   * email or phone), whether they have placed an order yet, and where the referral stands.
   */
  async listForReferrer(referrerUserId: string): Promise<Array<{ status: string; createdAt: Date; friendName: string | null; friendHasOrdered: boolean; rejectionReason: string | null }>> {
    if (!/^[0-9a-f-]{36}$/i.test(referrerUserId)) return [];
    const rows = rowsOf<{ status: string; created_at: Date | string; rejection_reason: string | null; friend_name: string | null; has_ordered: boolean }>(await db.execute(sql`
      select r.status, r.created_at, r.rejection_reason,
             (select o.customer_name from orders o where o.user_id = r.referee_user_id order by o.created_at desc limit 1) as friend_name,
             exists (select 1 from orders o where o.user_id = r.referee_user_id and o.status not in ('cancelled', 'failed')) as has_ordered
        from loyalty_referrals r
       where r.referrer_user_id = ${referrerUserId}::uuid
       order by r.created_at desc
       limit 100`));
    return rows.map((r) => ({
      status: r.status, createdAt: new Date(r.created_at), friendName: r.friend_name ? friendDisplayName(r.friend_name) : null,
      friendHasOrdered: r.has_ordered === true, rejectionReason: r.rejection_reason,
    }));
  }

  /** The referral this customer arrived with, if any (any status). */
  async referralOf(refereeUserId: string): Promise<{ status: string } | null> {
    const row = await db.query.loyaltyReferrals.findFirst({ where: eq(loyaltyReferrals.refereeUserId, refereeUserId) });
    return row ? { status: row.status } : null;
  }

  /** Who sent this code, as the friend sees it ("Rob S."), or null when the code is not a customer's. */
  async inviterFor(code: string): Promise<{ name: string } | null> {
    const rows = rowsOf<{ id: string; name: string | null }>(await db.execute(sql`
      select u.id, (select o.customer_name from orders o where o.user_id = u.id order by o.created_at desc limit 1) as name
        from users u where u.referral_code = ${code} and u.is_active = true limit 1`));
    if (!rows[0]) return null;
    return { name: rows[0].name ? friendDisplayName(rows[0].name) : 'A GoldPlus customer' };
  }

  /**
   * One invite link open. visitorKey is the random id the link put in the friend's browser; only its hash is kept.
   * The same browser opening the link again adds to opens, so "people who opened" and "opens" are both honest.
   */
  async recordVisit(code: string, visitorKey: string, how: ReferralShareChannel): Promise<void> {
    const visitorHash = createHash('sha256').update(`referral-visit:${visitorKey}`).digest('hex');
    await db.execute(sql`
      insert into loyalty_referral_visits (code, visitor_hash, how)
      select ${code}, ${visitorHash}, ${how} where exists (select 1 from users where referral_code = ${code})
      on conflict (code, visitor_hash) do update set opens = loyalty_referral_visits.opens + 1, last_seen_at = now()`);
  }

  /** The funnel over a window: link opens → friends who joined → first order placed → paid; plus held to decide. */
  async funnel(sinceDays: number): Promise<{ openedBy: number; opens: number; joined: number; ordered: number; awarded: number; held: number; bySource: Record<string, number>; byShare: Record<string, number> }> {
    const days = Math.max(1, Math.min(3650, Math.floor(sinceDays)));
    const [v] = rowsOf<{ opened_by: number; opens: number }>(await db.execute(sql`
      select count(*)::int as opened_by, coalesce(sum(opens), 0)::int as opens from loyalty_referral_visits
       where first_seen_at > now() - (${days} || ' days')::interval`));
    const [r] = rowsOf<{ joined: number; ordered: number; awarded: number; held: number }>(await db.execute(sql`
      select count(*)::int as joined,
             count(*) filter (where exists (select 1 from orders o where o.user_id = r.referee_user_id and o.status not in ('cancelled','failed')))::int as ordered,
             count(*) filter (where r.status = 'awarded')::int as awarded,
             count(*) filter (where r.status = 'held')::int as held
        from loyalty_referrals r where r.created_at > now() - (${days} || ' days')::interval`));
    const src = rowsOf<{ source: string; n: number }>(await db.execute(sql`
      select source, count(*)::int as n from loyalty_referrals where created_at > now() - (${days} || ' days')::interval group by source`));
    const share = rowsOf<{ how: string; n: number }>(await db.execute(sql`
      select how, count(*)::int as n from loyalty_referral_visits where first_seen_at > now() - (${days} || ' days')::interval group by how`));
    return {
      openedBy: Number(v?.opened_by ?? 0), opens: Number(v?.opens ?? 0),
      joined: Number(r?.joined ?? 0), ordered: Number(r?.ordered ?? 0), awarded: Number(r?.awarded ?? 0), held: Number(r?.held ?? 0),
      bySource: Object.fromEntries(src.map((x) => [x.source, Number(x.n)])),
      byShare: Object.fromEntries(share.map((x) => [x.how, Number(x.n)])),
    };
  }

  /** The admin list, newest first, optionally one status. */
  async adminList(status: string | null, limit = 200): Promise<ReferralAdminRow[]> {
    const st = status && ['pending', 'held', 'awarded', 'rejected'].includes(status) ? status : null;
    const rows = rowsOf<Record<string, any>>(await db.execute(sql`
      select r.id, r.code, r.status, r.source, r.held_reason, r.rejection_reason, r.created_at, r.updated_at,
             ru.email as referrer_email, fu.email as referee_email, qo.order_number as qualifying_order_number,
             (select count(*)::int from orders o where o.user_id = r.referee_user_id and o.status not in ('cancelled','failed')) as friend_orders
        from loyalty_referrals r
        left join users ru on ru.id = r.referrer_user_id
        left join users fu on fu.id = r.referee_user_id
        left join orders qo on qo.id = r.qualifying_order_id
       where ${st ? sql`r.status = ${st}` : sql`true`}
       order by (r.status = 'held') desc, r.created_at desc
       limit ${Math.max(1, Math.min(500, limit))}`));
    return rows.map((x) => ({
      id: x.id, code: x.code, status: x.status, source: x.source, heldReason: x.held_reason ?? null, rejectionReason: x.rejection_reason ?? null,
      referrerEmail: x.referrer_email ?? null, refereeEmail: x.referee_email ?? null, qualifyingOrderNumber: x.qualifying_order_number ?? null,
      friendOrders: Number(x.friend_orders ?? 0), createdAt: new Date(x.created_at).toISOString(), updatedAt: new Date(x.updated_at).toISOString(),
    }));
  }
}

/** Birthday source: users who opted in with a DOB matching today (UTC). */
export class DrizzleBirthdayUserSource {
  async usersWithBirthdayOn(monthDay: { month: number; day: number }): Promise<Array<{ userId: string }>> {
    const rows = (await db.execute(sql`
      select id from users
      where date_of_birth is not null and is_active = true
        and extract(month from date_of_birth) = ${monthDay.month}
        and extract(day from date_of_birth) = ${monthDay.day}`)) as unknown as Array<{ id: string }>;
    return rows.map((r) => ({ userId: r.id }));
  }
}
