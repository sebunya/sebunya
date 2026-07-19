import '../config/env';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';
import { EvaluateCartPricingUseCase } from '../application/use-cases/pricing/EvaluateCartPricingUseCase';
import { PricingGovernanceUseCase } from '../application/use-cases/pricing/PricingGovernanceUseCase';
import { PromotionVersionDraft } from '../domain/pricing/Pricing';
import { db, endDbConnection } from '../infrastructure/db/client';
import { DrizzleAuditRepository } from '../infrastructure/db/repositories/DrizzleAuditRepository';
import { DrizzlePricingQuoteRepository } from '../infrastructure/db/repositories/DrizzlePricingQuoteRepository';
import { DrizzlePricingRepository } from '../infrastructure/db/repositories/DrizzlePricingRepository';
import { DrizzleProductRepository } from '../infrastructure/db/repositories/DrizzleProductRepository';
import { categories, productPrices, products } from '../infrastructure/db/schema/products';
import { pricingAdjustments, pricingQuoteLines, pricingQuotes, promotionApprovals, promotionDefinitions, promotionVersions } from '../infrastructure/db/schema/pricing';
import { auditLogs } from '../infrastructure/db/schema/system';

const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const actorId = randomUUID(); const categoryId = randomUUID(); const productIds = [randomUUID(), randomUUID()]; const definitionIds: string[] = []; const quoteIds: string[] = [];
  let report: Record<string, unknown> = {}; let failure: unknown;
  try {
    await db.insert(categories).values({ id: categoryId, name: 'Pricing proof', slug: `pricing-proof-${randomUUID()}` });
    await db.insert(products).values(productIds.map((id, index) => ({ id, sku: `PRICE-${id.slice(0, 8)}`, modelNumber: `MODEL-${index}`, name: `Canonical ${index}`, slug: `pricing-${id}`, categoryId, categoryName: 'Pricing proof', priceUgx: index ? 50_000 : 100_000, approvalStatus: 'approved', hasRetailPrice: true, stockQuantity: 10 })));
    await db.insert(productPrices).values(productIds.map((productId, index) => ({ productId, retailPrice: index ? 50_000 : 100_000 })));
    const pricingRepo = new DrizzlePricingRepository(); const quoteRepo = new DrizzlePricingQuoteRepository();
    const governance = new PricingGovernanceUseCase(pricingRepo, new CreateAuditLogUseCase(new DrizzleAuditRepository()));
    const now = new Date();
    const base: Omit<PromotionVersionDraft, 'benefits' | 'priority' | 'stackable'> = { conditions: [], exclusions: [], schedule: { startsAt: new Date(now.getTime() - 60_000), endsAt: new Date(now.getTime() + 3_600_000) }, usagePolicy: { globalLimit: null, perCustomerLimit: null, perCouponLimit: null, reservationTtlSeconds: 900 }, couponCode: null, priceFloorUgx: 1 };
    for (const spec of [
      { key: 'ten-percent', benefits: [{ type: 'PERCENTAGE_OFF' as const, value: 1000 }], priority: 20, stackable: true },
      { key: 'fixed-safe', benefits: [{ type: 'FIXED_AMOUNT_OFF' as const, value: 5_000, targetProductIds: [productIds[0]] }], priority: 10, stackable: false },
    ]) {
      const created = await governance.create({ key: `${spec.key}-${randomUUID()}`, name: spec.key, description: 'P2 deterministic proof', actorId, version: { ...base, benefits: spec.benefits, priority: spec.priority, stackable: spec.stackable } });
      definitionIds.push(created.definition.id);
      const ready = await governance.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: 1, to: 'READY_FOR_REVIEW', actorId, reason: 'proof review', now });
      const approved = await governance.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: ready.definition.revision, to: 'APPROVED', actorId, reason: 'proof approval', now });
      await governance.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: approved.definition.revision, to: 'ACTIVE', actorId, reason: 'proof activation', now });
    }
    const evaluator = new EvaluateCartPricingUseCase(new DrizzleProductRepository(), pricingRepo, quoteRepo);
    const quote = await evaluator.execute({ items: [{ productId: productIds[1], quantity: 1 }, { productId: productIds[0], quantity: 2 }], shippingUgx: 10_000, evaluatedAt: now, persist: true });
    quoteIds.push(quote.id);
    const stored = await quoteRepo.findQuote(quote.id);
    const simulation = await evaluator.execute({ items: [{ productId: productIds[0], quantity: 2 }, { productId: productIds[1], quantity: 1 }], shippingUgx: 10_000, evaluatedAt: now, persist: false });
    const counts: any = await db.execute(sql`select (select count(*)::int from pricing_quotes where id=${quote.id}) as quotes, (select count(*)::int from pricing_quote_lines where quote_id=${quote.id}) as lines, (select count(*)::int from pricing_adjustments where quote_id=${quote.id}) as adjustments, jsonb_typeof((select decision_trace from pricing_quotes where id=${quote.id})) as trace_type`);
    const count = (counts.rows ?? counts)[0];
    assert(quote.baseSubtotalUgx === 250_000 && quote.discountTotalUgx === 30_000 && quote.finalTotalUgx === 230_000, 'authoritative totals mismatch');
    assert(stored?.finalTotalUgx === quote.finalTotalUgx && stored.appliedPromotionVersions.every((item) => item.versionNumber === 1), 'persisted quote mismatch');
    assert(simulation.baseSubtotalUgx === quote.baseSubtotalUgx && simulation.discountTotalUgx === quote.discountTotalUgx && simulation.finalTotalUgx === quote.finalTotalUgx, 'evaluation was not deterministic');
    assert(Number(count.quotes) === 1 && Number(count.lines) === 2 && Number(count.adjustments) === 3 && count.trace_type === 'array', 'quote persistence contract failed');
    const persistedAfterSimulation = await db.select().from(pricingQuotes);
    assert(persistedAfterSimulation.filter((row) => quoteIds.includes(row.id)).length === 1, 'simulation persisted a quote');
    report = { canonicalBaseSubtotalUgx: quote.baseSubtotalUgx, discountTotalUgx: quote.discountTotalUgx, finalTotalUgx: quote.finalTotalUgx, appliedVersions: quote.appliedPromotionVersions.length, excludedCandidates: quote.excludedCandidates.length, persistedQuotes: 1, persistedLines: 2, persistedAdjustments: 3, decisionTraceType: count.trace_type, simulationPersisted: false, deterministicTotals: true, providerCalls: 0 };
  } catch (error) { failure = error; }
  finally {
    try {
      if (quoteIds.length) { await db.delete(pricingAdjustments).where(inArray(pricingAdjustments.quoteId, quoteIds)); await db.delete(pricingQuoteLines).where(inArray(pricingQuoteLines.quoteId, quoteIds)); await db.delete(pricingQuotes).where(inArray(pricingQuotes.id, quoteIds)); }
      if (definitionIds.length) { await db.update(promotionDefinitions).set({ activeVersionId: null }).where(inArray(promotionDefinitions.id, definitionIds)); const versions = await db.select({ id: promotionVersions.id }).from(promotionVersions).where(inArray(promotionVersions.definitionId, definitionIds)); if (versions.length) await db.delete(promotionApprovals).where(inArray(promotionApprovals.versionId, versions.map((row) => row.id))); await db.delete(auditLogs).where(inArray(auditLogs.entityId, definitionIds)); await db.delete(promotionVersions).where(inArray(promotionVersions.definitionId, definitionIds)); await db.delete(promotionDefinitions).where(inArray(promotionDefinitions.id, definitionIds)); }
      await db.delete(productPrices).where(inArray(productPrices.productId, productIds)); await db.delete(products).where(inArray(products.id, productIds)); await db.delete(categories).where(eq(categories.id, categoryId));
      const productResidue = await db.select({ id: products.id }).from(products).where(inArray(products.id, productIds));
      const definitionResidue = definitionIds.length ? await db.select({ id: promotionDefinitions.id }).from(promotionDefinitions).where(inArray(promotionDefinitions.id, definitionIds)) : [];
      const quoteResidue = quoteIds.length ? await db.select({ id: pricingQuotes.id }).from(pricingQuotes).where(inArray(pricingQuotes.id, quoteIds)) : [];
      report.proofResidue = productResidue.length + definitionResidue.length + quoteResidue.length; if (report.proofResidue !== 0) failure ??= new Error('PRICING_P2_PROOF_RESIDUE');
    } catch (error) { failure ??= error; }
    try { await endDbConnection(); } catch (error) { failure ??= error; }
  }
  console.log(JSON.stringify({ ...report, verdict: failure ? 'FAIL' : 'PASS' })); if (failure) throw failure;
}
main().catch((error) => { console.error('PRICING_EVALUATION_PROOF_ERROR', error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
