import { and, asc, eq, sql } from 'drizzle-orm';
import {
  IPricingRepository,
  PromotionApprovalRecord,
  PromotionDefinitionRecord,
  PromotionVersionRecord,
} from '../../../application/ports/IPricingRepository';
import { PromotionStatus, PromotionVersionDraft } from '../../../domain/pricing/Pricing';
import { decodePricingJsonb, encodePricingJsonb } from '../PricingJsonbCodec';
import { db } from '../client';
import { promotionApprovals, promotionDefinitions, promotionVersions } from '../schema/pricing';

type VersionRow = typeof promotionVersions.$inferSelect;

function definitionRecord(row: typeof promotionDefinitions.$inferSelect): PromotionDefinitionRecord {
  return { ...row, status: row.status as PromotionStatus };
}

function versionRecord(row: VersionRow): PromotionVersionRecord {
  return {
    id: row.id,
    definitionId: row.definitionId,
    versionNumber: row.versionNumber,
    status: row.status as PromotionStatus,
    conditions: decodePricingJsonb<PromotionVersionDraft['conditions']>(row.conditions),
    benefits: decodePricingJsonb<PromotionVersionDraft['benefits']>(row.benefits),
    exclusions: decodePricingJsonb<PromotionVersionDraft['exclusions']>(row.exclusions),
    schedule: { startsAt: row.startsAt, endsAt: row.endsAt },
    usagePolicy: {
      globalLimit: row.globalLimit,
      perCustomerLimit: row.perCustomerLimit,
      perCouponLimit: row.perCouponLimit,
      reservationTtlSeconds: row.reservationTtlSeconds,
    },
    priority: row.priority,
    stackable: row.stackable,
    couponCode: row.couponCode,
    priceFloorUgx: row.priceFloorUgx,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    submittedAt: row.submittedAt,
    approvedAt: row.approvedAt,
    approvedBy: row.approvedBy,
  };
}

function versionValues(definitionId: string, versionNumber: number, actorId: string, version: PromotionVersionDraft) {
  return {
    definitionId,
    versionNumber,
    conditions: encodePricingJsonb(version.conditions) as any,
    benefits: encodePricingJsonb(version.benefits) as any,
    exclusions: encodePricingJsonb(version.exclusions) as any,
    startsAt: version.schedule.startsAt,
    endsAt: version.schedule.endsAt,
    globalLimit: version.usagePolicy.globalLimit,
    perCustomerLimit: version.usagePolicy.perCustomerLimit,
    perCouponLimit: version.usagePolicy.perCouponLimit,
    reservationTtlSeconds: version.usagePolicy.reservationTtlSeconds,
    priority: version.priority,
    stackable: version.stackable,
    couponCode: version.couponCode ?? null,
    priceFloorUgx: version.priceFloorUgx,
    createdBy: actorId,
  };
}

export class DrizzlePricingRepository implements IPricingRepository {
  async createDefinition(input: { key: string; name: string; description: string; actorId: string; version: PromotionVersionDraft }) {
    return db.transaction(async (tx) => {
      const [definition] = await tx.insert(promotionDefinitions).values({ key: input.key, name: input.name, description: input.description, createdBy: input.actorId }).returning();
      const [version] = await tx.insert(promotionVersions).values(versionValues(definition.id, 1, input.actorId, input.version)).returning();
      return { definition: definitionRecord(definition), version: versionRecord(version) };
    });
  }

  async createVersion(input: { definitionId: string; expectedRevision: number; actorId: string; version: PromotionVersionDraft }) {
    return db.transaction(async (tx) => {
      const [updated] = await tx.update(promotionDefinitions)
        .set({ revision: sql`${promotionDefinitions.revision} + 1`, status: 'DRAFT', activeVersionId: null, updatedAt: new Date() })
        .where(and(eq(promotionDefinitions.id, input.definitionId), eq(promotionDefinitions.revision, input.expectedRevision), sql`${promotionDefinitions.status} in ('DRAFT','REJECTED','APPROVED','PAUSED','EXPIRED')`))
        .returning();
      if (!updated) return null;
      const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${promotionVersions.versionNumber}), 0)::int + 1` }).from(promotionVersions).where(eq(promotionVersions.definitionId, input.definitionId));
      const [version] = await tx.insert(promotionVersions).values(versionValues(input.definitionId, next, input.actorId, input.version)).returning();
      return versionRecord(version);
    });
  }

  async findDefinition(id: string) {
    const [row] = await db.select().from(promotionDefinitions).where(eq(promotionDefinitions.id, id)).limit(1);
    return row ? definitionRecord(row) : null;
  }

  async findVersion(id: string) {
    const [row] = await db.select().from(promotionVersions).where(eq(promotionVersions.id, id)).limit(1);
    return row ? versionRecord(row) : null;
  }

  async listDefinitions() {
    return (await db.select().from(promotionDefinitions).orderBy(asc(promotionDefinitions.createdAt))).map(definitionRecord);
  }

  async transitionVersion(input: { definitionId: string; versionId: string; expectedRevision: number; from: PromotionStatus; to: PromotionStatus; actorId: string; reason: string; now: Date }) {
    return db.transaction(async (tx) => {
      const [definition] = await tx.update(promotionDefinitions)
        .set({
          status: input.to,
          revision: sql`${promotionDefinitions.revision} + 1`,
          activeVersionId: input.to === 'ACTIVE' ? input.versionId : input.to === 'ARCHIVED' ? null : undefined,
          updatedAt: input.now,
        })
        .where(and(eq(promotionDefinitions.id, input.definitionId), eq(promotionDefinitions.revision, input.expectedRevision)))
        .returning();
      if (!definition) return null;
      const [version] = await tx.update(promotionVersions)
        .set({
          status: input.to,
          submittedAt: input.to === 'READY_FOR_REVIEW' ? input.now : undefined,
          approvedAt: input.to === 'APPROVED' ? input.now : undefined,
          approvedBy: input.to === 'APPROVED' ? input.actorId : undefined,
        })
        .where(and(eq(promotionVersions.id, input.versionId), eq(promotionVersions.definitionId, input.definitionId), eq(promotionVersions.status, input.from)))
        .returning();
      if (!version) throw new Error('STALE_PROMOTION_VERSION');
      if (input.to === 'APPROVED' || input.to === 'REJECTED') {
        await tx.insert(promotionApprovals).values({ versionId: input.versionId, decision: input.to, actorId: input.actorId, reason: input.reason, decidedAt: input.now });
      }
      return { definition: definitionRecord(definition), version: versionRecord(version) };
    });
  }

  async listApprovals(versionId: string): Promise<PromotionApprovalRecord[]> {
    return (await db.select().from(promotionApprovals).where(eq(promotionApprovals.versionId, versionId)).orderBy(asc(promotionApprovals.decidedAt))).map((row) => ({ ...row, decision: row.decision as PromotionApprovalRecord['decision'] }));
  }
}
