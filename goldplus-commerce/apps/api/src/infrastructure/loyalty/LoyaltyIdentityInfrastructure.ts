import { createHash, randomInt } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema/identity';
import { loyaltyAccountMerges, phoneVerificationCodes } from '../db/schema/loyalty';
import { outboxEvents } from '../db/schema/system';
import { ILoyaltyIdentityRepository, IOtpSender } from '../../application/use-cases/loyalty/LoyaltyIdentityUseCases';

export class DrizzleLoyaltyIdentityRepository implements ILoyaltyIdentityRepository {
  async createOtp(input: { userId: string; phoneE164: string; codeHash: string; expiresAt: Date }): Promise<void> {
    await db.insert(phoneVerificationCodes).values({
      userId: input.userId,
      phoneE164: input.phoneE164,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
    });
  }

  async latestOtp(userId: string) {
    const row = await db.query.phoneVerificationCodes.findFirst({
      where: and(eq(phoneVerificationCodes.userId, userId), isNull(phoneVerificationCodes.consumedAt)),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
    return row
      ? { id: row.id, phoneE164: row.phoneE164, codeHash: row.codeHash, attempts: row.attempts, expiresAt: row.expiresAt, consumedAt: row.consumedAt }
      : null;
  }

  async bumpOtpAttempts(id: string): Promise<number> {
    const [row] = await db
      .update(phoneVerificationCodes)
      .set({ attempts: sql`${phoneVerificationCodes.attempts} + 1` })
      .where(eq(phoneVerificationCodes.id, id))
      .returning({ attempts: phoneVerificationCodes.attempts });
    return row?.attempts ?? 99;
  }

  async consumeOtp(id: string): Promise<void> {
    await db.update(phoneVerificationCodes).set({ consumedAt: new Date() }).where(eq(phoneVerificationCodes.id, id));
  }

  async markPhoneVerified(userId: string, phoneE164: string): Promise<void> {
    await db.update(users).set({ phone: phoneE164, phoneVerifiedAt: new Date() }).where(eq(users.id, userId));
  }

  async phoneVerifiedAt(userId: string): Promise<Date | null> {
    const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
    return (row as { phoneVerifiedAt?: Date | null } | undefined)?.phoneVerifiedAt ?? null;
  }

  async guestOrdersForPhone(phoneE164: string, lookbackDays: number) {
    // Exact-match on the E.164 and the local 0-prefixed form — orders store
    // whatever the customer typed; both shapes are the SAME verified number.
    const local = phoneE164.replace('+256', '0');
    const rows = (await db.execute(sql`
      select id, total_amount, buyer_type from orders
      where user_id is null
        and payment_status = 'paid'
        and status in ('delivered', 'completed')
        and created_at > now() - (${lookbackDays} || ' days')::interval
        and (customer_phone = ${phoneE164} or customer_phone = ${local})`)) as unknown as Array<{
      id: string;
      total_amount: string | number;
      buyer_type: string;
    }>;
    return rows.map((r) => ({ orderId: r.id, totalUgx: Number(r.total_amount), buyerType: r.buyer_type }));
  }

  async recordMerge(input: { mergedAccountId: string; survivorAccountId: string; actorId: string | null; note: string | null }): Promise<boolean> {
    const rows = await db
      .insert(loyaltyAccountMerges)
      .values({
        mergedAccountId: input.mergedAccountId,
        survivorAccountId: input.survivorAccountId,
        actorId: input.actorId,
        note: input.note,
      })
      .onConflictDoNothing()
      .returning();
    return rows.length > 0;
  }

  async mergedInto(accountId: string): Promise<string | null> {
    const row = await db.query.loyaltyAccountMerges.findFirst({ where: eq(loyaltyAccountMerges.mergedAccountId, accountId) });
    return row?.survivorAccountId ?? null;
  }

  async mergedSources(survivorAccountId: string): Promise<string[]> {
    const rows = await db.query.loyaltyAccountMerges.findMany({ where: eq(loyaltyAccountMerges.survivorAccountId, survivorAccountId) });
    return rows.map((r) => r.mergedAccountId);
  }

  /** 0087: the two profile facts the gamification surfaces branch on. */
  async identityFacts(userId: string): Promise<{ phoneVerifiedAt: Date | null; dateOfBirth: string | null }> {
    const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
    const typed = row as { phoneVerifiedAt?: Date | null; dateOfBirth?: string | null } | undefined;
    return { phoneVerifiedAt: typed?.phoneVerifiedAt ?? null, dateOfBirth: typed?.dateOfBirth ?? null };
  }

  /** 0087: DOB is set-once — the birthday earn source cannot be gamed by cycling dates. */
  async setDateOfBirthOnce(userId: string, isoDate: string): Promise<{ ok: boolean }> {
    const rows = await db
      .update(users)
      .set({ dateOfBirth: isoDate })
      .where(and(eq(users.id, userId), isNull(users.dateOfBirth)))
      .returning({ id: users.id });
    return { ok: rows.length > 0 };
  }
}

/** OTP through the existing outbox → SMS path — never a parallel sender. */
export class OutboxOtpSender implements IOtpSender {
  async send(phoneE164: string, code: string): Promise<'sent' | 'skipped'> {
    await db
      .insert(outboxEvents)
      .values({
        eventType: 'LOYALTY_EXPIRY_WARNING', // routed identically: SMS-first customer message
        payload: {
          kind: 'phone_verification',
          message: `Your GoldPlus verification code is ${code}. It expires in 10 minutes.`,
          customerPhone: phoneE164,
          customerEmail: null,
        } as never,
        idempotencyKey: `otp:${phoneE164}:${createHash('sha256').update(code).digest('hex').slice(0, 16)}`,
        status: 'pending',
        channel: 'sms',
        template: 'PHONE_VERIFICATION',
        dryRunOnly: false,
        relatedEntity: 'user_phone',
      })
      .onConflictDoNothing({ target: outboxEvents.idempotencyKey });
    return 'sent';
  }
}

export const otpHash = (v: string) => createHash('sha256').update(v).digest('hex');
export const otpRandom = () => String(randomInt(100000, 999999));

/* ── Tier repository (0086, PART L) ─────────────────────────────────────── */
import { loyaltyTierAssignments, loyaltyTiers } from '../db/schema/loyalty';
import { ILoyaltyTierRepository } from '../../application/use-cases/loyalty/LoyaltyProgrammeUseCases';

export class DrizzleLoyaltyTierRepository implements ILoyaltyTierRepository {
  async activeTiers() {
    const rows = await db.query.loyaltyTiers.findMany({ where: eq(loyaltyTiers.active, true) });
    return rows
      .filter((r) => r.thresholdLifetimePoints !== null)
      .map((r) => ({ code: r.code, name: r.name, thresholdLifetimePoints: r.thresholdLifetimePoints as number, rank: r.rank }));
  }

  async currentAssignment(accountId: string) {
    const row = await db.query.loyaltyTierAssignments.findFirst({ where: eq(loyaltyTierAssignments.accountId, accountId) });
    return row ? { tierCode: row.tierCode } : null;
  }

  async assign(accountId: string, tierCode: string): Promise<void> {
    await db
      .insert(loyaltyTierAssignments)
      .values({ accountId, tierCode, assignedAt: new Date() })
      .onConflictDoUpdate({ target: loyaltyTierAssignments.accountId, set: { tierCode, assignedAt: new Date() } });
  }

  async listTiers() {
    return db.query.loyaltyTiers.findMany({ orderBy: (t, { asc }) => [asc(t.rank)] });
  }

  async saveTier(input: { code: string; name?: string; thresholdLifetimePoints: number | null; benefits: unknown; active: boolean; updatedBy: string }) {
    // Activation blocked until the threshold is set (unset means unset).
    if (input.active && input.thresholdLifetimePoints === null) {
      return { ok: false as const, message: `Tier ${input.code} cannot activate: threshold unset.` };
    }
    const [row] = await db
      .update(loyaltyTiers)
      .set({
        ...(input.name ? { name: input.name } : {}),
        thresholdLifetimePoints: input.thresholdLifetimePoints,
        benefits: input.benefits ?? null,
        active: input.active,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(loyaltyTiers.code, input.code))
      .returning();
    return row ? { ok: true as const, tier: row } : { ok: false as const, message: 'Unknown tier.' };
  }
}

/* ── Programme-config writer (nulls preserved; nothing defaults) ─────────── */
import { loyaltyConfig } from '../db/schema/loyalty';

export class LoyaltyProgrammeConfigWriter {
  async save(input: {
    pointValueUgx: number | null;
    redemptionMinPoints: number | null;
    redemptionMaxShareBps: number | null;
    budgetCapPoints: number | null;
    killSwitch: boolean;
    guestBackfillLookbackDays: number | null;
    guestBackfillCapPoints: number | null;
    referralReferrerPoints?: number | null;
    referralRefereePoints?: number | null;
    birthdayPoints?: number | null;
    streakTargetOrders?: number | null;
    streakWindowDays?: number | null;
    streakRewardPoints?: number | null;
  }): Promise<void> {
    await db.update(loyaltyConfig).set({
      pointValueUgx: input.pointValueUgx,
      redemptionMinPoints: input.redemptionMinPoints,
      redemptionMaxShareBps: input.redemptionMaxShareBps,
      budgetCapPoints: input.budgetCapPoints,
      killSwitch: input.killSwitch,
      guestBackfillLookbackDays: input.guestBackfillLookbackDays,
      guestBackfillCapPoints: input.guestBackfillCapPoints,
      ...(input.referralReferrerPoints !== undefined ? { referralReferrerPoints: input.referralReferrerPoints } : {}),
      ...(input.referralRefereePoints !== undefined ? { referralRefereePoints: input.referralRefereePoints } : {}),
      ...(input.birthdayPoints !== undefined ? { birthdayPoints: input.birthdayPoints } : {}),
      ...(input.streakTargetOrders !== undefined ? { streakTargetOrders: input.streakTargetOrders } : {}),
      ...(input.streakWindowDays !== undefined ? { streakWindowDays: input.streakWindowDays } : {}),
      ...(input.streakRewardPoints !== undefined ? { streakRewardPoints: input.streakRewardPoints } : {}),
      updatedAt: new Date(),
    });
  }
}
