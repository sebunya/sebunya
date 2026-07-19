import '../config/env';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';
import { PricingGovernanceUseCase } from '../application/use-cases/pricing/PricingGovernanceUseCase';
import { PromotionVersionDraft } from '../domain/pricing/Pricing';
import { db, endDbConnection } from '../infrastructure/db/client';
import { DrizzleAuditRepository } from '../infrastructure/db/repositories/DrizzleAuditRepository';
import { DrizzlePricingRepository } from '../infrastructure/db/repositories/DrizzlePricingRepository';
import { promotionApprovals, promotionDefinitions, promotionVersions } from '../infrastructure/db/schema/pricing';
import { auditLogs } from '../infrastructure/db/schema/system';

const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const actorId = randomUUID();
  const ids: string[] = [];
  let report: Record<string, unknown> = {};
  let failure: unknown;
  try {
    const repo = new DrizzlePricingRepository();
    const useCase = new PricingGovernanceUseCase(repo, new CreateAuditLogUseCase(new DrizzleAuditRepository()));
    const now = new Date();
    const version: PromotionVersionDraft = {
      conditions: [{ type: 'MIN_CART_SUBTOTAL', value: 100_000 }],
      benefits: [{ type: 'PERCENTAGE_OFF', value: 1000, maximumDiscountUgx: 30_000 }],
      exclusions: [{ type: 'CATEGORY', value: 'regulated' }],
      schedule: { startsAt: new Date(now.getTime() - 60_000), endsAt: new Date(now.getTime() + 3_600_000) },
      usagePolicy: { globalLimit: 20, perCustomerLimit: 1, perCouponLimit: 20, reservationTtlSeconds: 900 },
      priority: 5,
      stackable: false,
      couponCode: 'proof-safe',
      priceFloorUgx: 1,
    };
    const created = await useCase.create({ key: `proof-${randomUUID()}`, name: 'Pricing governance proof', description: 'Self-cleaning immutable lifecycle proof.', actorId, version });
    ids.push(created.definition.id);
    assert(created.definition.status === 'DRAFT' && created.version.versionNumber === 1, 'draft creation failed');
    const ready = await useCase.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: 1, to: 'READY_FOR_REVIEW', actorId, reason: 'complete evidence', now });
    let directActivationDenied = false;
    try { await useCase.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: ready.definition.revision, to: 'ACTIVE', actorId, reason: 'must fail', now }); } catch { directActivationDenied = true; }
    const approved = await useCase.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: ready.definition.revision, to: 'APPROVED', actorId, reason: 'margin and schedule reviewed', now });
    const active = await useCase.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: approved.definition.revision, to: 'ACTIVE', actorId, reason: 'controlled proof only', now });
    const paused = await useCase.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: active.definition.revision, to: 'PAUSED', actorId, reason: 'proof complete', now });
    const typeResult: any = await db.execute(sql`select jsonb_typeof(conditions) as conditions_type, jsonb_typeof(benefits) as benefits_type, jsonb_typeof(exclusions) as exclusions_type from promotion_versions where id=${created.version.id}`);
    const types = (typeResult.rows ?? typeResult)[0];
    const approvals = await repo.listApprovals(created.version.id);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, created.definition.id));
    const defaultActive: any = await db.execute(sql`select count(*)::int as count from promotion_definitions where status='ACTIVE' and id <> ${created.definition.id}`);
    assert(directActivationDenied, 'draft/review activated without approval');
    assert(active.definition.activeVersionId === created.version.id && paused.definition.status === 'PAUSED', 'active/pause lifecycle failed');
    assert(approvals.length === 1 && approvals[0].decision === 'APPROVED', 'approval evidence missing');
    assert(types.conditions_type === 'array' && types.benefits_type === 'array' && types.exclusions_type === 'array', 'pricing JSONB was not native');
    assert(audits.length === 5, 'audit lifecycle incomplete');
    report = { lifecycle: 'DRAFT->READY_FOR_REVIEW->APPROVED->ACTIVE->PAUSED', immutableVersion: 1, directActivationDenied, approvalRows: approvals.length, auditRows: audits.length, jsonbTypes: [types.conditions_type, types.benefits_type, types.exclusions_type], unrelatedActivePromotions: Number((defaultActive.rows ?? defaultActive)[0].count), providerCalls: 0 };
  } catch (error) { failure = error; }
  finally {
    try {
      if (ids.length) {
        await db.update(promotionDefinitions).set({ activeVersionId: null }).where(inArray(promotionDefinitions.id, ids));
        const versions = await db.select({ id: promotionVersions.id }).from(promotionVersions).where(inArray(promotionVersions.definitionId, ids));
        if (versions.length) await db.delete(promotionApprovals).where(inArray(promotionApprovals.versionId, versions.map((row) => row.id)));
        await db.delete(auditLogs).where(inArray(auditLogs.entityId, ids));
        await db.delete(promotionVersions).where(inArray(promotionVersions.definitionId, ids));
        await db.delete(promotionDefinitions).where(inArray(promotionDefinitions.id, ids));
      }
      const residue: any = await db.execute(sql`select count(*)::int as count from promotion_definitions where name='Pricing governance proof'`);
      report.proofResidue = Number((residue.rows ?? residue)[0].count);
      if (report.proofResidue !== 0) failure ??= new Error('PRICING_PROOF_RESIDUE');
    } catch (error) { failure ??= error; }
    try { await endDbConnection(); } catch (error) { failure ??= error; }
  }
  console.log(JSON.stringify({ ...report, verdict: failure ? 'FAIL' : 'PASS' }));
  if (failure) throw failure;
}

main().catch((error) => { console.error('PRICING_GOVERNANCE_PROOF_ERROR', error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
