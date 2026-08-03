import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '../client';
import { creatorAttributions, creatorCommissions, creatorContentAssets, creatorPayouts } from '../schema/creators';
import { couponCodes, couponRedemptions } from '../schema/pricing';
import { AttributionMechanism, computeWithholding } from '../../../domain/creators/Commission';

export class CreatorPayoutError extends Error {
  constructor(public readonly code: 'MAKER_CHECKER_VIOLATION' | 'PAYOUT_NOT_FOUND' | 'PAYOUT_NOT_APPROVABLE', message: string) {
    super(message);
  }
}

export interface RecordAttributionCommissionInput {
  orderId: string;
  creatorId: string;
  mechanism: AttributionMechanism;
  confidence: 'high' | 'medium' | 'low';
  attributedRevenueUgx: number;
  /** Omit to record attribution only (e.g. an uncollected COD order → no commission). */
  commission: null | {
    contractId: string | null;
    grossRevenueUgx: number;
    commissionableRevenueUgx: number;
    commissionRateBps: number;
    commissionAmountUgx: number;
    status: 'pending' | 'held';
    holdUntil: Date | null;
  };
}

export class DrizzleCreatorRepository {
  /** AC1/AC3/AC5 — record the primary attribution and (optionally) the commission
   * in ONE transaction. Unique (order, creator) means at most one commission and a
   * retried call is idempotent. */
  async recordAttributionAndCommission(input: RecordAttributionCommissionInput): Promise<{ attributionId: string | null; commissionId: string | null }> {
    return db.transaction(async (tx) => {
      const attr = await tx
        .insert(creatorAttributions)
        .values({ orderId: input.orderId, creatorId: input.creatorId, mechanism: input.mechanism, confidence: input.confidence, attributedRevenueUgx: input.attributedRevenueUgx, isPrimary: true })
        .onConflictDoNothing()
        .returning({ id: creatorAttributions.id });

      let commissionId: string | null = null;
      if (input.commission) {
        const c = input.commission;
        const com = await tx
          .insert(creatorCommissions)
          .values({
            creatorId: input.creatorId,
            orderId: input.orderId,
            contractId: c.contractId,
            grossRevenueUgx: c.grossRevenueUgx,
            commissionableRevenueUgx: c.commissionableRevenueUgx,
            commissionRateBps: c.commissionRateBps,
            commissionAmountUgx: c.commissionAmountUgx,
            status: c.status,
            holdUntil: c.holdUntil,
          })
          .onConflictDoNothing()
          .returning({ id: creatorCommissions.id });
        commissionId = com.length ? com[0].id : null;
      }
      return { attributionId: attr.length ? attr[0].id : null, commissionId };
    });
  }

  /** AC2 — refund reverses the commission AND the coupon redemption in ONE
   * transaction. Idempotent. */
  async reverseForRefund(input: { orderId: string; creatorId: string; couponId: string | null; reason: string; now: Date }): Promise<{ reversed: boolean }> {
    return db.transaction(async (tx) => {
      const updated = await tx
        .update(creatorCommissions)
        .set({ status: 'reversed', reversedReason: input.reason, updatedAt: input.now })
        .where(and(eq(creatorCommissions.orderId, input.orderId), eq(creatorCommissions.creatorId, input.creatorId), sql`${creatorCommissions.status} <> 'reversed'`))
        .returning({ id: creatorCommissions.id });
      if (updated.length === 0) return { reversed: false };

      if (input.couponId) {
        const rev = await tx
          .update(couponRedemptions)
          .set({ wasReversed: true, reversedAt: input.now })
          .where(and(eq(couponRedemptions.couponId, input.couponId), eq(couponRedemptions.orderId, input.orderId), eq(couponRedemptions.wasReversed, false)))
          .returning({ id: couponRedemptions.id });
        if (rev.length > 0) {
          await tx.update(couponCodes).set({ redemptionCount: sql`GREATEST(${couponCodes.redemptionCount} - 1, 0)` }).where(eq(couponCodes.id, input.couponId));
        }
      }
      return { reversed: true };
    });
  }

  /** AC7/AC8 — batch a creator's approved, unpaid commissions into one payout:
   * gross = sum of commission amounts, withholding at the configured effective rate,
   * net = gross - withholding. The idempotency key is unique, so a RETRIED run
   * returns the existing payout instead of double-paying. Immutable line items:
   * the selected commissions are stamped with the payout id. */
  async createPayoutRun(input: { creatorId: string; periodStart: string; periodEnd: string; withholdingRateBps: number; createdBy: string; method: string; idempotencyKey: string; now: Date }): Promise<{ payoutId: string; duplicate: boolean; grossAmountUgx: number; withholdingTaxUgx: number; netAmountUgx: number } | null> {
    return db.transaction(async (tx) => {
      const existing = await tx.select().from(creatorPayouts).where(eq(creatorPayouts.idempotencyKey, input.idempotencyKey)).limit(1);
      if (existing.length) {
        const p = existing[0];
        return { payoutId: p.id, duplicate: true, grossAmountUgx: p.grossAmountUgx, withholdingTaxUgx: p.withholdingTaxUgx, netAmountUgx: p.netAmountUgx };
      }
      const commissions = await tx
        .select({ id: creatorCommissions.id, amount: creatorCommissions.commissionAmountUgx })
        .from(creatorCommissions)
        .where(and(eq(creatorCommissions.creatorId, input.creatorId), eq(creatorCommissions.status, 'approved'), isNull(creatorCommissions.payoutId)))
        .for('update');
      if (commissions.length === 0) return null;
      const gross = commissions.reduce((sum, c) => sum + c.amount, 0);
      const wh = computeWithholding(gross, input.withholdingRateBps);
      const [payout] = await tx
        .insert(creatorPayouts)
        .values({
          creatorId: input.creatorId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          grossAmountUgx: wh.grossAmountUgx,
          withholdingTaxUgx: wh.withholdingTaxUgx,
          netAmountUgx: wh.netAmountUgx,
          withholdingRateBps: input.withholdingRateBps,
          method: input.method,
          status: 'draft',
          createdBy: input.createdBy,
          idempotencyKey: input.idempotencyKey,
        })
        .returning({ id: creatorPayouts.id });
      // Stamp the immutable line items with this payout.
      for (const c of commissions) {
        await tx.update(creatorCommissions).set({ payoutId: payout.id, updatedAt: input.now }).where(eq(creatorCommissions.id, c.id));
      }
      return { payoutId: payout.id, duplicate: false, grossAmountUgx: wh.grossAmountUgx, withholdingTaxUgx: wh.withholdingTaxUgx, netAmountUgx: wh.netAmountUgx };
    });
  }

  /** AC6 — maker/checker: the approver must differ from the payout's creator. */
  async approvePayout(input: { payoutId: string; approverId: string; now: Date }): Promise<{ status: string }> {
    return db.transaction(async (tx) => {
      const [payout] = await tx.select().from(creatorPayouts).where(eq(creatorPayouts.id, input.payoutId)).for('update').limit(1);
      if (!payout) throw new CreatorPayoutError('PAYOUT_NOT_FOUND', 'Payout not found.');
      if (payout.status !== 'draft') throw new CreatorPayoutError('PAYOUT_NOT_APPROVABLE', `Payout is ${payout.status}.`);
      if (payout.createdBy === input.approverId) {
        throw new CreatorPayoutError('MAKER_CHECKER_VIOLATION', 'A payout run cannot be approved by the user who created it.');
      }
      await tx.update(creatorPayouts).set({ status: 'approved', approvedBy: input.approverId, initiatedAt: input.now }).where(eq(creatorPayouts.id, input.payoutId));
      return { status: 'approved' };
    });
  }

  /** AC9 — repeat-purchase cohort. Customers acquired by this creator (their first
   * order attributed to the creator) who place another order within `windowDays`.
   * The customer identity anchor is the phone (the phone-first Ugandan reality,
   * same key as first-order eligibility); first_party_identities provides
   * cross-device linkage as an enhancement. One query, no per-row round-trips. */
  async repeatPurchaseCohort(creatorId: string, windowDays: number): Promise<{ acquiredCount: number; repeatCount: number; rateBps: number }> {
    const rows = await db.execute(sql`
      WITH acquired AS (
        SELECT o.customer_phone AS cust, MIN(o.created_at) AS acquired_at
        FROM creator_attributions a
        JOIN orders o ON o.id = a.order_id
        WHERE a.creator_id = ${creatorId} AND a.is_primary
        GROUP BY o.customer_phone
      )
      SELECT
        count(*)::int AS acquired_count,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM orders r
          WHERE r.customer_phone = acquired.cust
            AND r.created_at > acquired.acquired_at
            AND r.created_at <= acquired.acquired_at + (${windowDays} * INTERVAL '1 day')
        ))::int AS repeat_count
      FROM acquired`);
    const row: any = (rows as any).rows ? (rows as any).rows[0] : (rows as any)[0];
    const acquiredCount = Number(row?.acquired_count ?? 0);
    const repeatCount = Number(row?.repeat_count ?? 0);
    const rateBps = acquiredCount === 0 ? 0 : Math.round((repeatCount / acquiredCount) * 10_000);
    return { acquiredCount, repeatCount, rateBps };
  }

  /** AC10 — assets approved for ads, EXCLUDING any whose usage rights have expired
   * as of `asOf`. One query. */
  async approvedForAdsAssets(creatorId: string, asOf: Date): Promise<Array<{ id: string; rightsExpiry: string | null }>> {
    const asOfDate = asOf.toISOString().slice(0, 10);
    return db
      .select({ id: creatorContentAssets.id, rightsExpiry: creatorContentAssets.rightsExpiry })
      .from(creatorContentAssets)
      .where(
        and(
          eq(creatorContentAssets.creatorId, creatorId),
          eq(creatorContentAssets.approvedForAds, true),
          or(isNull(creatorContentAssets.rightsExpiry), gt(creatorContentAssets.rightsExpiry, asOfDate)),
        ),
      );
  }
}
