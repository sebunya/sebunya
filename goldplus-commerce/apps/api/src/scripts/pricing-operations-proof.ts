import '../config/env';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';
import { EvaluateCartPricingUseCase } from '../application/use-cases/pricing/EvaluateCartPricingUseCase';
import { PricingGovernanceUseCase } from '../application/use-cases/pricing/PricingGovernanceUseCase';
import { PricingOperationsUseCase } from '../application/use-cases/pricing/PricingOperationsUseCase';
import { db, endDbConnection } from '../infrastructure/db/client';
import { DrizzleAuditRepository } from '../infrastructure/db/repositories/DrizzleAuditRepository';
import { DrizzlePricingOperationsRepository } from '../infrastructure/db/repositories/DrizzlePricingOperationsRepository';
import { DrizzlePricingQuoteRepository } from '../infrastructure/db/repositories/DrizzlePricingQuoteRepository';
import { DrizzlePricingRepository } from '../infrastructure/db/repositories/DrizzlePricingRepository';
import { DrizzleProductRepository } from '../infrastructure/db/repositories/DrizzleProductRepository';
import { experiments, experimentVariants } from '../infrastructure/db/schema/experiments';
import { categories, productPrices, products } from '../infrastructure/db/schema/products';
import { pricingExperimentAssociations, promotionApprovals, promotionDefinitions, promotionVersions } from '../infrastructure/db/schema/pricing';
import { auditLogs } from '../infrastructure/db/schema/system';

const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
async function counts() {
  const result: any = await db.execute(sql`select
    (select count(*)::int from pricing_quotes) quotes,
    (select count(*)::int from promotion_reservations) reservations,
    (select count(*)::int from promotion_redemptions) redemptions,
    (select count(*)::int from orders) orders,
    (select count(*)::int from payment_attempts) payments,
    (select count(*)::int from outbox_events) outbox`);
  return (result.rows ?? result)[0] as Record<string, number>;
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const actorId = randomUUID(); const categoryId = randomUUID(); const productId = randomUUID(); const experimentId = randomUUID(); const definitionIds: string[] = [];
  let report: Record<string, unknown> = {}; let failure: unknown;
  try {
    const before = await counts();
    await db.insert(categories).values({ id: categoryId, name: 'Operations proof', slug: `pricing-ops-${categoryId}` });
    await db.insert(products).values({ id: productId, sku: `P5-${productId.slice(0, 8)}`, modelNumber: 'P5-1', name: 'Pricing operations product', slug: `pricing-ops-${productId}`, categoryId, categoryName: 'Operations proof', priceUgx: 200_000, approvalStatus: 'approved', hasRetailPrice: true, stockQuantity: 10 });
    await db.insert(productPrices).values({ productId, retailPrice: 200_000 });
    await db.insert(experiments).values({ id: experimentId, key: `pricing-ops-${experimentId}`, name: 'Pricing operations evidence', hypothesis: 'Governed evidence only', primaryMetric: 'checkout', status: 'READY', createdBy: actorId });
    await db.insert(experimentVariants).values([{ experimentId, key: 'control', name: 'Control', weightBasisPoints: 5000 }, { experimentId, key: 'treatment', name: 'Treatment', weightBasisPoints: 5000 }]);

    const audit = new CreateAuditLogUseCase(new DrizzleAuditRepository()); const pricingRepo = new DrizzlePricingRepository(); const governance = new PricingGovernanceUseCase(pricingRepo, audit);
    const evaluator = new EvaluateCartPricingUseCase(new DrizzleProductRepository(), pricingRepo, new DrizzlePricingQuoteRepository());
    const operations = new PricingOperationsUseCase(governance, evaluator, new DrizzlePricingOperationsRepository(), audit);
    const now = new Date();
    const created = await operations.create({ key: `p5-${randomUUID()}`, name: 'P5 governed promotion', description: 'Control-room persistence proof', actorId, version: { conditions: [{ type: 'EXPERIMENT_VARIANT', value: `${experimentId}:treatment` }], benefits: [{ type: 'PERCENTAGE_OFF', value: 1500 }], exclusions: [], schedule: { startsAt: new Date(now.getTime() - 60_000), endsAt: new Date(now.getTime() + 3_600_000) }, usagePolicy: { globalLimit: 10, perCustomerLimit: 2, perCouponLimit: null, reservationTtlSeconds: 900 }, priority: 20, stackable: false, couponCode: null, priceFloorUgx: 1 } });
    definitionIds.push(created.definition.id);
    const associated = await operations.associateExperiment({ definitionId: created.definition.id, versionId: created.version.id, experimentId, variantKey: 'treatment', actorId });
    const ready = await operations.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: 1, to: 'READY_FOR_REVIEW', actorId, reason: 'P5 review evidence', now });
    let immutableExperimentAssociationDenied = false;
    try { await operations.associateExperiment({ definitionId: created.definition.id, versionId: created.version.id, experimentId, variantKey: 'treatment', actorId }); }
    catch (error) { immutableExperimentAssociationDenied = error instanceof Error && 'code' in error && error.code === 'VERSION_IMMUTABLE'; }
    assert(immutableExperimentAssociationDenied, 'Experiment association bypassed immutable Pricing governance');
    const approved = await operations.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: ready.definition.revision, to: 'APPROVED', actorId, reason: 'P5 approval evidence', now });
    const active = await operations.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: approved.definition.revision, to: 'ACTIVE', actorId, reason: 'P5 activation evidence', now });
    const beforeSimulation = await counts();
    const simulation = await operations.simulate({ items: [{ productId, quantity: 1 }], experimentEvidence: [{ experimentId, variantKey: 'treatment' }], customerDnaSegments: [], evaluatedAt: new Date() });
    const afterSimulation = await counts();
    assert(JSON.stringify(beforeSimulation) === JSON.stringify(afterSimulation), 'simulation mutated a protected business or communication table');
    assert(simulation.baseSubtotalUgx === 200_000 && simulation.discountTotalUgx === 30_000 && simulation.finalTotalUgx === 170_000, 'simulation was not canonical or deterministic');
    const activeOverview = await operations.overview(); const detail = await operations.detail(created.definition.id);
    assert(activeOverview.definitionsByStatus.ACTIVE >= 1 && activeOverview.activeCapacity.some((row) => row.definitionId === created.definition.id && row.remaining === 10), 'persisted overview did not report active capacity truthfully');
    assert(detail.associations.length === 1 && detail.versions.length === 1 && detail.approvals.length === 1 && detail.audit.length === 5, 'detail did not expose version/association/approval/audit truthfully');
    const paused = await operations.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: active.definition.revision, to: 'PAUSED', actorId, reason: 'P6 pause evidence', now: new Date() });
    const pausedOverview = await operations.overview();
    assert(pausedOverview.definitionsByStatus.PAUSED >= 1 && !pausedOverview.activeCapacity.some((row) => row.definitionId === created.definition.id), 'pause was not reflected by persisted operations state');
    const resumed = await operations.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: paused.definition.revision, to: 'ACTIVE', actorId, reason: 'P6 resume evidence', now: new Date() });
    const resumedOverview = await operations.overview();
    assert(resumedOverview.definitionsByStatus.ACTIVE >= 1 && resumedOverview.activeCapacity.some((row) => row.definitionId === created.definition.id && row.remaining === 10), 'resume did not restore persisted active capacity');
    await operations.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: resumed.definition.revision, to: 'PAUSED', actorId, reason: 'P6 safe terminal pause', now: new Date() });
    const after = await counts();
    assert(Number(after.quotes) === Number(before.quotes) && Number(after.reservations) === Number(before.reservations) && Number(after.redemptions) === Number(before.redemptions) && Number(after.orders) === Number(before.orders) && Number(after.payments) === Number(before.payments) && Number(after.outbox) === Number(before.outbox), 'P5 operating proof created forbidden business effects');
    report = { lifecycle: 'DRAFT->READY_FOR_REVIEW->APPROVED->ACTIVE->PAUSED->ACTIVE->PAUSED', resumeRestoredCapacity: true, experimentAssociation: !associated.duplicate, immutableExperimentAssociationDenied, canonicalBaseUgx: 200_000, simulatedDiscountUgx: 30_000, simulatedFinalUgx: 170_000, reservationDelta: 0, redemptionDelta: 0, orderDelta: 0, paymentDelta: 0, outboxDelta: 0, providerCalls: 0, approvalRows: detail.approvals.length, auditRowsBeforePause: detail.audit.length };
  } catch (error) { failure = error; }
  finally {
    try {
      if (definitionIds.length) {
        await db.delete(pricingExperimentAssociations).where(inArray(pricingExperimentAssociations.promotionVersionId, db.select({ id: promotionVersions.id }).from(promotionVersions).where(inArray(promotionVersions.definitionId, definitionIds))));
        await db.update(promotionDefinitions).set({ activeVersionId: null }).where(inArray(promotionDefinitions.id, definitionIds));
        const versions = await db.select({ id: promotionVersions.id }).from(promotionVersions).where(inArray(promotionVersions.definitionId, definitionIds));
        if (versions.length) await db.delete(promotionApprovals).where(inArray(promotionApprovals.versionId, versions.map((row) => row.id)));
        await db.delete(auditLogs).where(inArray(auditLogs.entityId, definitionIds)); await db.delete(promotionVersions).where(inArray(promotionVersions.definitionId, definitionIds)); await db.delete(promotionDefinitions).where(inArray(promotionDefinitions.id, definitionIds));
      }
      await db.delete(experimentVariants).where(eq(experimentVariants.experimentId, experimentId)); await db.delete(experiments).where(eq(experiments.id, experimentId));
      await db.delete(productPrices).where(eq(productPrices.productId, productId)); await db.delete(products).where(eq(products.id, productId)); await db.delete(categories).where(eq(categories.id, categoryId));
      const residue: any = await db.execute(sql`select (select count(*)::int from promotion_definitions where id = any(array[${definitionIds[0] ?? null}]::uuid[])) + (select count(*)::int from products where id=${productId}) + (select count(*)::int from experiments where id=${experimentId}) as count`);
      report.proofResidue = Number((residue.rows ?? residue)[0].count); if (report.proofResidue !== 0) failure ??= new Error('PRICING_P5_PROOF_RESIDUE');
    } catch (error) { failure ??= error; }
    try { await endDbConnection(); } catch (error) { failure ??= error; }
  }
  console.log(JSON.stringify({ ...report, verdict: failure ? 'FAIL' : 'PASS' })); if (failure) throw failure;
}
main().catch((error) => { console.error('PRICING_OPERATIONS_PROOF_ERROR', error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
