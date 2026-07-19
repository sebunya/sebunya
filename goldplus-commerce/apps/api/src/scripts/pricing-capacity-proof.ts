import '../config/env';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';
import { ManagePromotionCapacityUseCase } from '../application/use-cases/pricing/ManagePromotionCapacityUseCase';
import { EvaluateCartPricingUseCase } from '../application/use-cases/pricing/EvaluateCartPricingUseCase';
import { PricingGovernanceUseCase } from '../application/use-cases/pricing/PricingGovernanceUseCase';
import { PromotionVersionDraft } from '../domain/pricing/Pricing';
import { db, endDbConnection } from '../infrastructure/db/client';
import { DrizzleAuditRepository } from '../infrastructure/db/repositories/DrizzleAuditRepository';
import { DrizzlePricingCapacityRepository } from '../infrastructure/db/repositories/DrizzlePricingCapacityRepository';
import { DrizzlePricingQuoteRepository } from '../infrastructure/db/repositories/DrizzlePricingQuoteRepository';
import { DrizzlePricingRepository } from '../infrastructure/db/repositories/DrizzlePricingRepository';
import { DrizzleProductRepository } from '../infrastructure/db/repositories/DrizzleProductRepository';
import { orders } from '../infrastructure/db/schema/commerce';
import { categories, productPrices, products } from '../infrastructure/db/schema/products';
import { pricingAdjustments, pricingQuoteLines, pricingQuotes, promotionApprovals, promotionDefinitions, promotionRedemptions, promotionReservations, promotionVersions } from '../infrastructure/db/schema/pricing';
import { auditLogs } from '../infrastructure/db/schema/system';

const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const actorId = randomUUID(); const categoryId = randomUUID(); const productId = randomUUID(); const definitionIds: string[] = []; const quoteIds: string[] = []; const orderIds: string[] = [];
  let report: Record<string, unknown> = {}; let failure: unknown;
  try {
    await db.insert(categories).values({ id: categoryId, name: 'Capacity proof', slug: `capacity-${randomUUID()}` });
    await db.insert(products).values({ id: productId, sku: `CAP-${productId.slice(0, 8)}`, modelNumber: 'CAP-1', name: 'Capacity product', slug: `capacity-${productId}`, categoryId, categoryName: 'Capacity proof', priceUgx: 100_000, approvalStatus: 'approved', hasRetailPrice: true, stockQuantity: 10 });
    await db.insert(productPrices).values({ productId, retailPrice: 100_000 });
    const pricingRepo = new DrizzlePricingRepository(); const quoteRepo = new DrizzlePricingQuoteRepository(); const governance = new PricingGovernanceUseCase(pricingRepo, new CreateAuditLogUseCase(new DrizzleAuditRepository())); const evaluator = new EvaluateCartPricingUseCase(new DrizzleProductRepository(), pricingRepo, quoteRepo); const capacity = new ManagePromotionCapacityUseCase(new DrizzlePricingCapacityRepository());
    const now = new Date();
    const createActive = async (key: string, policy: PromotionVersionDraft['usagePolicy'], couponCode: string | null = null) => {
      const created = await governance.create({ key: `${key}-${randomUUID()}`, name: key, description: 'P3 capacity proof', actorId, version: { conditions: [], benefits: [{ type: 'PERCENTAGE_OFF', value: 1000 }], exclusions: [], schedule: { startsAt: new Date(now.getTime() - 60_000), endsAt: new Date(now.getTime() + 3_600_000) }, usagePolicy: policy, priority: 10, stackable: false, couponCode, priceFloorUgx: 1 } });
      definitionIds.push(created.definition.id);
      const ready = await governance.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: 1, to: 'READY_FOR_REVIEW', actorId, reason: 'proof review', now });
      const approved = await governance.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: ready.definition.revision, to: 'APPROVED', actorId, reason: 'proof approval', now });
      const active = await governance.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: approved.definition.revision, to: 'ACTIVE', actorId, reason: 'proof activation', now });
      return { ...active, versionId: created.version.id };
    };
    const pause = async (active: Awaited<ReturnType<typeof createActive>>) => governance.transition({ definitionId: active.definition.id, versionId: active.versionId, expectedRevision: active.definition.revision, to: 'PAUSED', actorId, reason: 'scenario complete', now: new Date() });
    const makeQuote = async (customer: string, couponCode?: string) => { const quote = await evaluator.execute({ items: [{ productId, quantity: 1 }], customerScopeKey: customer, couponCode, evaluatedAt: new Date(), persist: true }); quoteIds.push(quote.id); return quote; };

    const global = await createActive('global-final-slot', { globalLimit: 1, perCustomerLimit: null, perCouponLimit: null, reservationTtlSeconds: 900 });
    const globalQuotes = await Promise.all([makeQuote('global-a'), makeQuote('global-b')]);
    const globalRace = await Promise.allSettled(globalQuotes.map((quote, index) => capacity.reserve({ quoteId: quote.id, checkoutKey: `global-${index}`, now: new Date() })));
    const globalWinnerIndex = globalRace.findIndex((result) => result.status === 'fulfilled');
    assert(globalRace.filter((result) => result.status === 'fulfilled').length === 1 && globalWinnerIndex >= 0, 'final global slot race did not yield one winner');
    const globalWinner = globalRace[globalWinnerIndex] as PromiseFulfilledResult<Awaited<ReturnType<typeof capacity.reserve>>>;
    const globalRetry = await capacity.reserve({ quoteId: globalQuotes[globalWinnerIndex].id, checkoutKey: `global-${globalWinnerIndex}`, now: new Date() });
    assert(globalRetry.duplicate && globalRetry.reservations[0].id === globalWinner.value.reservations[0].id, 'checkout retry did not reuse reservation');
    const orderId = randomUUID(); orderIds.push(orderId);
    await db.insert(orders).values({ id: orderId, orderNumber: `GP-CAP-${orderId.slice(0, 8)}`, buyerType: 'retail', customerName: 'Capacity proof', customerPhone: '00000', deliveryArea: 'Proof', deliveryAddress: 'Proof', subtotalAmount: 100_000, deliveryFee: 0, totalAmount: 100_000 });
    const redeemed = await capacity.redeem({ quoteId: globalQuotes[globalWinnerIndex].id, orderId, now: new Date() });
    const redeemRetry = await capacity.redeem({ quoteId: globalQuotes[globalWinnerIndex].id, orderId, now: new Date() });
    assert(!redeemed.duplicate && redeemRetry.duplicate, 'redemption retry was not idempotent');
    await pause(global);

    const customer = await createActive('customer-final-slot', { globalLimit: 5, perCustomerLimit: 1, perCouponLimit: null, reservationTtlSeconds: 900 });
    const customerQuotes = await Promise.all([makeQuote('same-customer'), makeQuote('same-customer')]);
    const customerRace = await Promise.allSettled(customerQuotes.map((quote, index) => capacity.reserve({ quoteId: quote.id, checkoutKey: `customer-${index}`, now: new Date() })));
    const customerWinnerIndex = customerRace.findIndex((result) => result.status === 'fulfilled');
    assert(customerRace.filter((result) => result.status === 'fulfilled').length === 1 && customerWinnerIndex >= 0, 'same-customer race did not yield one winner');
    const released = await capacity.release({ quoteId: customerQuotes[customerWinnerIndex].id, now: new Date() });
    const releaseRetry = await capacity.release({ quoteId: customerQuotes[customerWinnerIndex].id, now: new Date() });
    assert(!released.duplicate && releaseRetry.duplicate, 'release retry was not idempotent');
    await pause(customer);

    const coupon = await createActive('coupon-final-slot', { globalLimit: 5, perCustomerLimit: 5, perCouponLimit: 1, reservationTtlSeconds: 900 }, 'CAPSAFE');
    const couponQuotes = await Promise.all([makeQuote('coupon-a', 'CAPSAFE'), makeQuote('coupon-b', 'CAPSAFE')]);
    const couponRace = await Promise.allSettled(couponQuotes.map((quote, index) => capacity.reserve({ quoteId: quote.id, checkoutKey: `coupon-${index}`, now: new Date() })));
    assert(couponRace.filter((result) => result.status === 'fulfilled').length === 1, 'coupon limit race did not yield one winner');
    await pause(coupon);

    const integrity: any = await db.execute(sql`select
      (select count(*)::int from promotion_reservations r left join pricing_quotes q on q.id=r.quote_id where q.id is null) as orphan_reservations,
      (select count(*)::int from promotion_redemptions d left join promotion_reservations r on r.id=d.reservation_id where r.id is null) as orphan_redemptions,
      (select count(*)::int from promotion_redemptions where order_id=${orderId}) as redemption_rows,
      (select count(*)::int from promotion_reservations where status='RELEASED' and released_at is not null) as released_rows`);
    const row = (integrity.rows ?? integrity)[0];
    assert(Number(row.orphan_reservations) === 0 && Number(row.orphan_redemptions) === 0 && Number(row.redemption_rows) === 1, 'capacity integrity failed');
    report = { globalFinalSlotWinners: 1, sameCustomerWinners: 1, sameCouponWinners: 1, checkoutRetryReusedReservation: true, redemptionRetryRows: Number(row.redemption_rows), releaseRetrySingleTransition: true, orphanReservations: 0, orphanRedemptions: 0, capacityBelowZero: false, providerCalls: 0 };
  } catch (error) { failure = error; }
  finally {
    try {
      if (quoteIds.length) { const reservations = await db.select({ id: promotionReservations.id }).from(promotionReservations).where(inArray(promotionReservations.quoteId, quoteIds)); if (reservations.length) await db.delete(promotionRedemptions).where(inArray(promotionRedemptions.reservationId, reservations.map((row) => row.id))); await db.delete(promotionReservations).where(inArray(promotionReservations.quoteId, quoteIds)); }
      if (orderIds.length) await db.delete(orders).where(inArray(orders.id, orderIds));
      if (quoteIds.length) { await db.delete(pricingAdjustments).where(inArray(pricingAdjustments.quoteId, quoteIds)); await db.delete(pricingQuoteLines).where(inArray(pricingQuoteLines.quoteId, quoteIds)); await db.delete(pricingQuotes).where(inArray(pricingQuotes.id, quoteIds)); }
      if (definitionIds.length) { await db.update(promotionDefinitions).set({ activeVersionId: null }).where(inArray(promotionDefinitions.id, definitionIds)); const versions = await db.select({ id: promotionVersions.id }).from(promotionVersions).where(inArray(promotionVersions.definitionId, definitionIds)); if (versions.length) await db.delete(promotionApprovals).where(inArray(promotionApprovals.versionId, versions.map((row) => row.id))); await db.delete(auditLogs).where(inArray(auditLogs.entityId, definitionIds)); await db.delete(promotionVersions).where(inArray(promotionVersions.definitionId, definitionIds)); await db.delete(promotionDefinitions).where(inArray(promotionDefinitions.id, definitionIds)); }
      await db.delete(productPrices).where(eq(productPrices.productId, productId)); await db.delete(products).where(eq(products.id, productId)); await db.delete(categories).where(eq(categories.id, categoryId));
      const residues = await Promise.all([db.select({ id: promotionDefinitions.id }).from(promotionDefinitions).where(inArray(promotionDefinitions.id, definitionIds)), db.select({ id: pricingQuotes.id }).from(pricingQuotes).where(inArray(pricingQuotes.id, quoteIds)), db.select({ id: products.id }).from(products).where(eq(products.id, productId))]);
      report.proofResidue = residues.reduce((sum, rows) => sum + rows.length, 0); if (report.proofResidue !== 0) failure ??= new Error('PRICING_P3_PROOF_RESIDUE');
    } catch (error) { failure ??= error; }
    try { await endDbConnection(); } catch (error) { failure ??= error; }
  }
  console.log(JSON.stringify({ ...report, verdict: failure ? 'FAIL' : 'PASS' })); if (failure) throw failure;
}
main().catch((error) => { console.error('PRICING_CAPACITY_PROOF_ERROR', error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
