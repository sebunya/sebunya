import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { IPricingOperationsRepository, PricingCapacitySummary } from '../../../application/ports/IPricingOperationsRepository';
import { PromotionApprovalRecord, PromotionDefinitionRecord, PromotionVersionRecord } from '../../../application/ports/IPricingRepository';
import { PromotionStatus, PromotionVersionDraft } from '../../../domain/pricing/Pricing';
import { db } from '../client';
import { decodePricingJsonb } from '../PricingJsonbCodec';
import { experiments, experimentVariants } from '../schema/experiments';
import { pricingExperimentAssociations, pricingQuotes, promotionApprovals, promotionDefinitions, promotionRedemptions, promotionReservations, promotionVersions } from '../schema/pricing';
import { auditLogs } from '../schema/system';

const definitionRecord = (row: typeof promotionDefinitions.$inferSelect): PromotionDefinitionRecord => ({ ...row, status: row.status as PromotionStatus });
const versionRecord = (row: typeof promotionVersions.$inferSelect): PromotionVersionRecord => ({
  id: row.id, definitionId: row.definitionId, versionNumber: row.versionNumber, status: row.status as PromotionStatus,
  conditions: decodePricingJsonb<PromotionVersionDraft['conditions']>(row.conditions), benefits: decodePricingJsonb<PromotionVersionDraft['benefits']>(row.benefits), exclusions: decodePricingJsonb<PromotionVersionDraft['exclusions']>(row.exclusions),
  schedule: { startsAt: row.startsAt, endsAt: row.endsAt }, usagePolicy: { globalLimit: row.globalLimit, perCustomerLimit: row.perCustomerLimit, perCouponLimit: row.perCouponLimit, reservationTtlSeconds: row.reservationTtlSeconds },
  priority: row.priority, stackable: row.stackable, couponCode: row.couponCode, priceFloorUgx: row.priceFloorUgx, createdBy: row.createdBy, createdAt: row.createdAt, submittedAt: row.submittedAt, approvedAt: row.approvedAt, approvedBy: row.approvedBy,
});

export class DrizzlePricingOperationsRepository implements IPricingOperationsRepository {
  private async capacityFor(definitionIds?: string[]): Promise<PricingCapacitySummary[]> {
    const where = definitionIds?.length ? inArray(promotionDefinitions.id, definitionIds) : eq(promotionDefinitions.status, 'ACTIVE');
    const rows = await db.select({ definitionId: promotionDefinitions.id, definitionName: promotionDefinitions.name, versionId: promotionVersions.id, versionNumber: promotionVersions.versionNumber, globalLimit: promotionVersions.globalLimit })
      .from(promotionVersions).innerJoin(promotionDefinitions, eq(promotionDefinitions.id, promotionVersions.definitionId)).where(where).orderBy(asc(promotionDefinitions.name), asc(promotionVersions.versionNumber));
    const result: PricingCapacitySummary[] = [];
    for (const row of rows) {
      const counts = await db.select({ status: promotionReservations.status, count: sql<number>`count(*)::int` }).from(promotionReservations).where(eq(promotionReservations.promotionVersionId, row.versionId)).groupBy(promotionReservations.status);
      const byStatus = new Map(counts.map((item) => [item.status, item.count]));
      // Same predicate as reserveQuote: a RESERVED row past its expiry is not
      // capacity in use, it is a checkout that was abandoned.
      const [live] = await db.select({ count: sql<number>`count(*)::int` }).from(promotionReservations)
        .where(and(eq(promotionReservations.promotionVersionId, row.versionId), eq(promotionReservations.status, 'RESERVED'), sql`${promotionReservations.expiresAt} > now()`));
      const reserved = live?.count ?? 0;
      const redeemed = byStatus.get('REDEEMED') ?? 0;
      result.push({ ...row, reserved, redeemed, remaining: row.globalLimit == null ? null : Math.max(0, row.globalLimit - reserved - redeemed) });
    }
    return result;
  }

  async overview() {
    const definitionCounts = await db.select({ status: promotionDefinitions.status, count: sql<number>`count(*)::int` }).from(promotionDefinitions).groupBy(promotionDefinitions.status);
    const reservationCounts = await db.select({ status: promotionReservations.status, count: sql<number>`count(*)::int` }).from(promotionReservations).groupBy(promotionReservations.status);
    const [{ count: quoteCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(pricingQuotes);
    const [{ count: redemptionCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(promotionRedemptions);
    return { definitionsByStatus: Object.fromEntries(definitionCounts.map((row) => [row.status, row.count])), reservationsByStatus: Object.fromEntries(reservationCounts.map((row) => [row.status, row.count])), quoteCount, redemptionCount, activeCapacity: await this.capacityFor() };
  }

  async detail(definitionId: string) {
    const [definition] = await db.select().from(promotionDefinitions).where(eq(promotionDefinitions.id, definitionId)).limit(1);
    if (!definition) return null;
    const versionRows = await db.select().from(promotionVersions).where(eq(promotionVersions.definitionId, definitionId)).orderBy(desc(promotionVersions.versionNumber));
    const versionIds = versionRows.map((row) => row.id);
    const approvals = versionIds.length ? await db.select().from(promotionApprovals).where(inArray(promotionApprovals.versionId, versionIds)).orderBy(desc(promotionApprovals.decidedAt)) : [];
    const associations = versionIds.length ? await db.select({ promotionVersionId: pricingExperimentAssociations.promotionVersionId, experimentId: pricingExperimentAssociations.experimentId, experimentKey: experiments.key, variantKey: pricingExperimentAssociations.variantKey }).from(pricingExperimentAssociations).innerJoin(experiments, eq(experiments.id, pricingExperimentAssociations.experimentId)).where(inArray(pricingExperimentAssociations.promotionVersionId, versionIds)) : [];
    const audit = await db.select({ id: auditLogs.id, actorId: auditLogs.actorId, action: auditLogs.action, createdAt: auditLogs.createdAt }).from(auditLogs).where(and(eq(auditLogs.entity, 'promotion_definition'), eq(auditLogs.entityId, definitionId))).orderBy(desc(auditLogs.createdAt)).limit(100);
    return { definition: definitionRecord(definition), versions: versionRows.map(versionRecord), approvals: approvals.map((row) => ({ ...row, decision: row.decision as PromotionApprovalRecord['decision'] })), associations, capacity: await this.capacityFor([definitionId]), audit };
  }

  async associateExperiment(input: { definitionId: string; versionId: string; experimentId: string; variantKey: string }) {
    return db.transaction(async (tx) => {
      const [version] = await tx.select().from(promotionVersions).where(and(eq(promotionVersions.id, input.versionId), eq(promotionVersions.definitionId, input.definitionId))).limit(1);
      if (!version) return 'NOT_FOUND' as const;
      if (version.status !== 'DRAFT') return 'VERSION_IMMUTABLE' as const;
      const [variant] = await tx.select().from(experimentVariants).innerJoin(experiments, eq(experiments.id, experimentVariants.experimentId)).where(and(eq(experimentVariants.experimentId, input.experimentId), eq(experimentVariants.key, input.variantKey))).limit(1);
      if (!variant || !['READY', 'RUNNING', 'PAUSED'].includes(variant.experiments.status)) return 'EXPERIMENT_NOT_READY' as const;
      const inserted = await tx.insert(pricingExperimentAssociations).values({ promotionVersionId: input.versionId, experimentId: input.experimentId, variantKey: input.variantKey }).onConflictDoNothing().returning({ versionId: pricingExperimentAssociations.promotionVersionId });
      return inserted.length ? 'CREATED' as const : 'DUPLICATE' as const;
    });
  }
}
