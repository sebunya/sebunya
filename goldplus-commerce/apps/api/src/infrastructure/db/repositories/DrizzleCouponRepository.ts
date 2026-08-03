import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { couponCodes, couponRedemptions } from '../schema/pricing';
import {
  CouponRecord,
  CouponRedeemResult,
  GenerateCouponBatchInput,
  GenerateCouponBatchResult,
  ICouponRepository,
  RedeemCouponInput,
} from '../../../application/ports/ICouponRepository';
import { generateUniqueCouponCodes } from '../../../domain/pricing/CouponCodeGenerator';

/** Thrown inside the redeem transaction to roll it back while carrying the
 * structured reason back out to the caller. */
class CouponGateError extends Error {
  constructor(public readonly reason: Exclude<CouponRedeemResult, { ok: true }>['reason']) {
    super(reason);
  }
}

export class DrizzleCouponRepository implements ICouponRepository {
  async generateBatch(input: GenerateCouponBatchInput): Promise<GenerateCouponBatchResult> {
    const target = input.count;
    if (!Number.isInteger(target) || target < 1 || target > 100_000) {
      throw new Error('Coupon batch count must be an integer from 1 to 100,000.');
    }
    const length = input.length ?? 12;
    const prefix = (input.prefix ?? '').trim().toUpperCase();
    if (prefix.length + length > 40) {
      // Lookup normalises to a 3-40 char identifier; a longer code could never be redeemed.
      throw new Error('Coupon prefix + length must be at most 40 characters.');
    }
    const batchId = randomUUID();
    const collected = new Set<string>();
    // Retry the shortfall so a DB-level collision against an already-persisted
    // code never fails the batch. Bounded so an over-tight space fails loudly.
    for (let attempt = 0; attempt < 16 && collected.size < target; attempt++) {
      const need = target - collected.size;
      const candidates = generateUniqueCouponCodes(need, { length, prefix }).filter((c) => !collected.has(c));
      if (candidates.length === 0) continue;
      // Chunk so a large batch stays well under PostgreSQL's 65,535 bind-parameter
      // ceiling (each row binds ~8 columns).
      const CHUNK = 1000;
      for (let i = 0; i < candidates.length; i += CHUNK) {
        const slice = candidates.slice(i, i + CHUNK);
        const rows = await db
          .insert(couponCodes)
          .values(
            slice.map((code) => ({
              promotionDefinitionId: input.promotionDefinitionId,
              code,
              codeNormalised: code, // generated codes are already canonical (uppercase, unambiguous)
              codeType: input.codeType ?? 'bulk_batch',
              batchId,
              maxRedemptions: input.maxRedemptions ?? null,
              startsAt: input.startsAt ?? null,
              expiresAt: input.expiresAt ?? null,
            })),
          )
          .onConflictDoNothing({ target: couponCodes.codeNormalised })
          .returning({ code: couponCodes.code });
        rows.forEach((r) => collected.add(r.code));
      }
    }
    return { batchId, requested: target, inserted: collected.size, codes: Array.from(collected) };
  }

  /** Admin overview: totals + recent codes with per-code redemption counts. */
  async adminOverview(limit = 50): Promise<{ totalCodes: number; totalRedemptions: number; recent: Array<{ id: string; code: string; codeType: string; maxRedemptions: number | null; redemptionCount: number; isActive: boolean; createdAt: Date }> }> {
    const [tot] = await db.select({ n: sql<number>`count(*)::int` }).from(couponCodes);
    const [red] = await db.select({ n: sql<number>`count(*)::int` }).from(couponRedemptions).where(eq(couponRedemptions.wasReversed, false));
    const recent = await db
      .select({ id: couponCodes.id, code: couponCodes.code, codeType: couponCodes.codeType, maxRedemptions: couponCodes.maxRedemptions, redemptionCount: couponCodes.redemptionCount, isActive: couponCodes.isActive, createdAt: couponCodes.createdAt })
      .from(couponCodes)
      .orderBy(desc(couponCodes.createdAt))
      .limit(Math.min(limit, 200));
    return { totalCodes: tot?.n ?? 0, totalRedemptions: red?.n ?? 0, recent };
  }

  async findByNormalisedCode(codeNormalised: string): Promise<CouponRecord | null> {
    const rows = await db.select().from(couponCodes).where(eq(couponCodes.codeNormalised, codeNormalised)).limit(1);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      promotionDefinitionId: r.promotionDefinitionId,
      code: r.code,
      codeNormalised: r.codeNormalised,
      codeType: r.codeType,
      maxRedemptions: r.maxRedemptions ?? null,
      redemptionCount: r.redemptionCount,
      isActive: r.isActive,
      startsAt: r.startsAt ?? null,
      expiresAt: r.expiresAt ?? null,
    };
  }

  async redeem(input: RedeemCouponInput): Promise<CouponRedeemResult> {
    try {
      return await db.transaction(async (tx) => {
        // 1. Claim the (coupon, order) slot first. A retry for the same order
        //    conflicts here → idempotent success, and crucially does NOT reach the
        //    counter increment, so a retry never double-counts.
        const inserted = await tx
          .insert(couponRedemptions)
          .values({
            couponId: input.couponId,
            orderId: input.orderId,
            customerIdentityHash: input.customerIdentityHash,
            discountAmountUgx: input.discountAmountUgx,
          })
          .onConflictDoNothing({ target: [couponRedemptions.couponId, couponRedemptions.orderId] })
          .returning({ id: couponRedemptions.id });
        if (inserted.length === 0) {
          const existing = await tx
            .select({ id: couponRedemptions.id })
            .from(couponRedemptions)
            .where(and(eq(couponRedemptions.couponId, input.couponId), eq(couponRedemptions.orderId, input.orderId)))
            .limit(1);
          return { ok: true, alreadyRedeemed: true, redemptionId: existing[0].id };
        }

        // 2. Conditional counter gate. Under READ COMMITTED a concurrent request
        //    that lost the race re-reads the committed count and the predicate
        //    now fails, so exactly one of N racers passes. Never read-then-write.
        const now = new Date();
        const gate = await tx
          .update(couponCodes)
          .set({ redemptionCount: sql`${couponCodes.redemptionCount} + 1` })
          .where(sql`${couponCodes.id} = ${input.couponId}
            AND ${couponCodes.isActive} = true
            AND (${couponCodes.maxRedemptions} IS NULL OR ${couponCodes.redemptionCount} < ${couponCodes.maxRedemptions})
            AND (${couponCodes.startsAt} IS NULL OR ${couponCodes.startsAt} <= ${now})
            AND (${couponCodes.expiresAt} IS NULL OR ${couponCodes.expiresAt} > ${now})`)
          .returning({ id: couponCodes.id });
        if (gate.length === 0) {
          // Roll the slot insert back and report why the gate closed.
          const c = await tx.select().from(couponCodes).where(eq(couponCodes.id, input.couponId)).limit(1);
          throw new CouponGateError(this.gateReason(c[0], now));
        }
        return { ok: true, alreadyRedeemed: false, redemptionId: inserted[0].id };
      });
    } catch (err) {
      if (err instanceof CouponGateError) return { ok: false, reason: err.reason };
      throw err;
    }
  }

  private gateReason(
    coupon: typeof couponCodes.$inferSelect | undefined,
    now: Date,
  ): Exclude<CouponRedeemResult, { ok: true }>['reason'] {
    if (!coupon || !coupon.isActive) return 'COUPON_INACTIVE';
    if (coupon.startsAt && coupon.startsAt > now) return 'COUPON_NOT_STARTED';
    if (coupon.expiresAt && coupon.expiresAt <= now) return 'COUPON_EXPIRED';
    return 'COUPON_EXHAUSTED';
  }

  async hasRedeemedPromotionByIdentity(promotionDefinitionId: string, customerIdentityHash: string): Promise<boolean> {
    const rows = await db
      .select({ id: couponRedemptions.id })
      .from(couponRedemptions)
      .innerJoin(couponCodes, eq(couponCodes.id, couponRedemptions.couponId))
      .where(
        and(
          eq(couponCodes.promotionDefinitionId, promotionDefinitionId),
          eq(couponRedemptions.customerIdentityHash, customerIdentityHash),
          eq(couponRedemptions.wasReversed, false),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async reverse(couponId: string, orderId: string): Promise<{ reversed: boolean }> {
    return db.transaction(async (tx) => {
      const reversed = await tx
        .update(couponRedemptions)
        .set({ wasReversed: true, reversedAt: new Date() })
        .where(sql`${couponRedemptions.couponId} = ${couponId}
          AND ${couponRedemptions.orderId} = ${orderId}
          AND ${couponRedemptions.wasReversed} = false`)
        .returning({ id: couponRedemptions.id });
      if (reversed.length === 0) return { reversed: false };
      // Restore inventory, floored at zero so a stray reverse cannot go negative.
      await tx
        .update(couponCodes)
        .set({ redemptionCount: sql`GREATEST(${couponCodes.redemptionCount} - 1, 0)` })
        .where(eq(couponCodes.id, couponId));
      return { reversed: true };
    });
  }
}
