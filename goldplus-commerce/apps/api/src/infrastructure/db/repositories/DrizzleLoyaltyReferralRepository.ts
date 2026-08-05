import { randomBytes } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { users } from '../schema/identity';
import { loyaltyReferrals } from '../schema/loyalty';
import { ILoyaltyReferralRepository } from '../../../application/use-cases/loyalty/LoyaltyGamificationUseCases';

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
    // Retry on the (astronomically unlikely) unique collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      try {
        await db.update(users).set({ referralCode: code }).where(eq(users.id, userId));
        return code;
      } catch {
        continue;
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

  async recordReferral(input: { code: string; referrerUserId: string; refereeUserId: string }): Promise<'recorded' | 'duplicate'> {
    const inserted = await db
      .insert(loyaltyReferrals)
      .values({ code: input.code, referrerUserId: input.referrerUserId, refereeUserId: input.refereeUserId })
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

  async markAwarded(id: string, referrerEntryId: string, refereeEntryId: string, qualifyingOrderId: string): Promise<void> {
    await db
      .update(loyaltyReferrals)
      .set({
        status: 'awarded',
        referrerEntryId: referrerEntryId || null,
        refereeEntryId: refereeEntryId || null,
        qualifyingOrderId,
        updatedAt: new Date(),
      })
      .where(eq(loyaltyReferrals.id, id));
  }

  async markRejected(id: string, reason: string): Promise<void> {
    await db
      .update(loyaltyReferrals)
      .set({ status: 'rejected', rejectionReason: reason.slice(0, 120), updatedAt: new Date() })
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
      where user_id = ${userId} and payment_status = 'paid'
        and status in ('delivered','completed') and buyer_type = 'retail'`)) as unknown as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  }

  async listForReferrer(referrerUserId: string): Promise<Array<{ status: string; createdAt: Date }>> {
    const rows = await db.query.loyaltyReferrals.findMany({
      where: eq(loyaltyReferrals.referrerUserId, referrerUserId),
      orderBy: [desc(loyaltyReferrals.createdAt)],
    });
    return rows.map((r) => ({ status: r.status, createdAt: r.createdAt }));
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
