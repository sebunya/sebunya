import { and, eq, inArray, sql } from 'drizzle-orm';
import { IPricingCapacityRepository, PromotionReservationRecord, PromotionReservationStatus } from '../../../application/ports/IPricingCapacityRepository';
import { db } from '../client';
import { pricingAdjustments, pricingQuotes, promotionDefinitions, promotionRedemptions, promotionReservations, promotionVersions } from '../schema/pricing';

const asRecord = (row: typeof promotionReservations.$inferSelect): PromotionReservationRecord => ({ id: row.id, quoteId: row.quoteId, promotionVersionId: row.promotionVersionId, status: row.status as PromotionReservationStatus, reservedAt: row.reservedAt, expiresAt: row.expiresAt });

export class DrizzlePricingCapacityRepository implements IPricingCapacityRepository {
  async reserveQuote(input: { quoteId: string; idempotencyKey: string; now: Date }) {
    return db.transaction(async (tx) => {
      const [quote] = await tx.select().from(pricingQuotes).where(eq(pricingQuotes.id, input.quoteId)).limit(1);
      if (!quote) throw new Error('PRICING_QUOTE_NOT_FOUND');
      if (quote.expiresAt <= input.now) throw new Error('PRICING_QUOTE_EXPIRED');
      const applied = await tx.select({ versionId: pricingAdjustments.promotionVersionId }).from(pricingAdjustments).where(eq(pricingAdjustments.quoteId, input.quoteId)).groupBy(pricingAdjustments.promotionVersionId);
      const versionIds = applied.map((item) => item.versionId).sort();
      if (!versionIds.length) return { reservations: [], duplicate: false };
      for (const versionId of versionIds) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${versionId}, 0))`);
      await tx.update(promotionReservations).set({ status: 'EXPIRED', updatedAt: input.now }).where(and(inArray(promotionReservations.promotionVersionId, versionIds), eq(promotionReservations.status, 'RESERVED'), sql`${promotionReservations.expiresAt} <= ${input.now}`));
      const existing = await tx.select().from(promotionReservations).where(and(eq(promotionReservations.quoteId, input.quoteId), eq(promotionReservations.idempotencyKey, input.idempotencyKey)));
      if (existing.length) {
        if (existing.length !== versionIds.length || existing.some((row) => !versionIds.includes(row.promotionVersionId))) throw new Error('PRICING_RESERVATION_PARTIAL_REPLAY');
        return { reservations: existing.map(asRecord), duplicate: true };
      }
      const created: PromotionReservationRecord[] = [];
      for (const versionId of versionIds) {
        const [rule] = await tx.select({ version: promotionVersions, definition: promotionDefinitions }).from(promotionVersions).innerJoin(promotionDefinitions, eq(promotionDefinitions.id, promotionVersions.definitionId)).where(eq(promotionVersions.id, versionId)).limit(1);
        if (!rule || rule.version.status !== 'ACTIVE' || rule.definition.status !== 'ACTIVE' || rule.definition.activeVersionId !== versionId || rule.version.startsAt > input.now || rule.version.endsAt <= input.now) throw new Error('PROMOTION_NOT_ACTIVE');
        if (rule.version.perCustomerLimit != null && !quote.customerScopeHash) throw new Error('CUSTOMER_SCOPE_REQUIRED');
        if (rule.version.perCouponLimit != null && rule.version.couponCode && !quote.couponReference) throw new Error('COUPON_SCOPE_REQUIRED');
        const activePredicate = sql`(${promotionReservations.status} = 'REDEEMED' OR (${promotionReservations.status} = 'RESERVED' AND ${promotionReservations.expiresAt} > ${input.now}))`;
        const [globalCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(promotionReservations).where(and(eq(promotionReservations.promotionVersionId, versionId), activePredicate));
        if (rule.version.globalLimit != null && (globalCount?.count ?? 0) >= rule.version.globalLimit) throw new Error('PROMOTION_GLOBAL_LIMIT_REACHED');
        if (rule.version.perCustomerLimit != null) {
          const [customerCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(promotionReservations).where(and(eq(promotionReservations.promotionVersionId, versionId), eq(promotionReservations.customerScopeHash, quote.customerScopeHash!), activePredicate));
          if ((customerCount?.count ?? 0) >= rule.version.perCustomerLimit) throw new Error('PROMOTION_CUSTOMER_LIMIT_REACHED');
        }
        if (rule.version.perCouponLimit != null && rule.version.couponCode) {
          const [couponCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(promotionReservations).where(and(eq(promotionReservations.promotionVersionId, versionId), eq(promotionReservations.couponReferenceHash, quote.couponReference!), activePredicate));
          if ((couponCount?.count ?? 0) >= rule.version.perCouponLimit) throw new Error('PROMOTION_COUPON_LIMIT_REACHED');
        }
        const expiresAt = new Date(Math.min(quote.expiresAt.getTime(), rule.version.endsAt.getTime(), input.now.getTime() + rule.version.reservationTtlSeconds * 1000));
        const [row] = await tx.insert(promotionReservations).values({ quoteId: input.quoteId, promotionVersionId: versionId, customerScopeHash: quote.customerScopeHash, couponReferenceHash: quote.couponReference, idempotencyKey: input.idempotencyKey, reservedAt: input.now, expiresAt, updatedAt: input.now }).returning();
        created.push(asRecord(row));
      }
      return { reservations: created, duplicate: false };
    });
  }

  async redeemQuote(input: { quoteId: string; orderId: string; now: Date }) {
    return db.transaction(async (tx) => {
      const reservations = await tx.select().from(promotionReservations).where(eq(promotionReservations.quoteId, input.quoteId));
      if (!reservations.length) return { reservationIds: [], duplicate: false };
      for (const versionId of [...new Set(reservations.map((row) => row.promotionVersionId))].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${versionId}, 0))`);
      const refreshed = await tx.select().from(promotionReservations).where(eq(promotionReservations.quoteId, input.quoteId));
      if (refreshed.every((row) => row.status === 'REDEEMED')) {
        const redemptions = await tx.select().from(promotionRedemptions).where(inArray(promotionRedemptions.reservationId, refreshed.map((row) => row.id)));
        if (redemptions.length !== refreshed.length || redemptions.some((row) => row.orderId !== input.orderId)) throw new Error('PRICING_REDEMPTION_ORDER_CONFLICT');
        return { reservationIds: refreshed.map((row) => row.id), duplicate: true };
      }
      if (refreshed.some((row) => row.status !== 'RESERVED' || row.expiresAt <= input.now)) throw new Error('PRICING_RESERVATION_NOT_REDEEMABLE');
      await tx.insert(promotionRedemptions).values(refreshed.map((row) => ({ reservationId: row.id, orderId: input.orderId, redeemedAt: input.now })));
      await tx.update(promotionReservations).set({ status: 'REDEEMED', updatedAt: input.now }).where(inArray(promotionReservations.id, refreshed.map((row) => row.id)));
      return { reservationIds: refreshed.map((row) => row.id), duplicate: false };
    });
  }

  async releaseQuote(input: { quoteId: string; now: Date }) {
    return db.transaction(async (tx) => {
      const reservations = await tx.select().from(promotionReservations).where(eq(promotionReservations.quoteId, input.quoteId));
      if (!reservations.length) return { reservationIds: [], duplicate: false };
      for (const versionId of [...new Set(reservations.map((row) => row.promotionVersionId))].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${versionId}, 0))`);
      const refreshed = await tx.select().from(promotionReservations).where(eq(promotionReservations.quoteId, input.quoteId));
      if (refreshed.every((row) => row.status === 'RELEASED')) return { reservationIds: refreshed.map((row) => row.id), duplicate: true };
      if (refreshed.some((row) => row.status !== 'RESERVED')) throw new Error('PRICING_RESERVATION_NOT_RELEASABLE');
      await tx.update(promotionReservations).set({ status: 'RELEASED', releasedAt: input.now, updatedAt: input.now }).where(inArray(promotionReservations.id, refreshed.map((row) => row.id)));
      return { reservationIds: refreshed.map((row) => row.id), duplicate: false };
    });
  }
}
