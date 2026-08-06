import '../config/env';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { CheckoutUseCase } from '../application/use-cases/commerce/CheckoutUseCase';
import { StartPesaPalPaymentUseCase } from '../application/use-cases/payments/StartPesaPalPaymentUseCase';
import { VerifyPesaPalPaymentUseCase } from '../application/use-cases/payments/VerifyPesaPalPaymentUseCase';
import { OrderTransitionService } from '../infrastructure/orders/OrderTransitionService';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';
import { EvaluateCartPricingUseCase } from '../application/use-cases/pricing/EvaluateCartPricingUseCase';
import { ManagePromotionCapacityUseCase } from '../application/use-cases/pricing/ManagePromotionCapacityUseCase';
import { PricingGovernanceUseCase } from '../application/use-cases/pricing/PricingGovernanceUseCase';
import { IPesaPalClient, PesaPalSubmitOrderInput } from '../application/ports/IPesaPalClient';
import { db, endDbConnection } from '../infrastructure/db/client';
import { DrizzleAuditRepository } from '../infrastructure/db/repositories/DrizzleAuditRepository';
import { DrizzleOrderRepository } from '../infrastructure/db/repositories/DrizzleOrderRepository';
import { DrizzlePaymentAttemptRepository } from '../infrastructure/db/repositories/DrizzlePaymentAttemptRepository';
import { DrizzlePricingCapacityRepository } from '../infrastructure/db/repositories/DrizzlePricingCapacityRepository';
import { DrizzlePricingQuoteRepository } from '../infrastructure/db/repositories/DrizzlePricingQuoteRepository';
import { DrizzlePricingRepository } from '../infrastructure/db/repositories/DrizzlePricingRepository';
import { DrizzleProductRepository } from '../infrastructure/db/repositories/DrizzleProductRepository';
import { orderItems, orders, paymentAttempts } from '../infrastructure/db/schema/commerce';
import { categories, productPrices, products } from '../infrastructure/db/schema/products';
import { pricingAdjustments, pricingQuoteLines, pricingQuotes, promotionApprovals, promotionDefinitions, promotionRedemptions, promotionReservations, promotionVersions } from '../infrastructure/db/schema/pricing';
import { auditLogs, outboxEvents } from '../infrastructure/db/schema/system';

const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };

class ControlledPesaPal implements IPesaPalClient {
  readonly submissions: PesaPalSubmitOrderInput[] = [];
  statusCalls = 0;
  async submitOrderRequest(input: PesaPalSubmitOrderInput) {
    this.submissions.push(input);
    return { order_tracking_id: `proof-tracking-${this.submissions.length}`, merchant_reference: input.id, redirect_url: 'https://example.invalid/proof-payment' };
  }
  async getTransactionStatus(orderTrackingId: string) {
    this.statusCalls += 1;
    const submission = this.submissions.at(-1)!;
    return { order_tracking_id: orderTrackingId, merchant_reference: submission.id, amount: submission.amount, currency: submission.currency, status_code: 1, payment_status_description: 'COMPLETED' };
  }
  async requestRefund(): Promise<{ status: string; message: string }> {
    throw new Error('PESAPAL_REFUND_UNAVAILABLE: the controlled proof harness does not refund.');
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const actorId = randomUUID();
  const categoryId = randomUUID();
  const productId = randomUUID();
  const definitionIds: string[] = [];
  const orderIds: string[] = [];
  let quoteIds: string[] = [];
  let report: Record<string, unknown> = {};
  let failure: unknown;
  const previousIpn = process.env.PESAPAL_IPN_ID;
  try {
    process.env.PESAPAL_IPN_ID = 'pricing-proof-ipn';
    const [{ count: outboxBefore }] = await db.select({ count: sql<number>`count(*)::int` }).from(outboxEvents);
    await db.insert(categories).values({ id: categoryId, name: 'Checkout proof', slug: `checkout-${categoryId}` });
    await db.insert(products).values({ id: productId, sku: `P4-${productId.slice(0, 8)}`, modelNumber: 'P4-1', name: 'Authoritative checkout product', slug: `checkout-${productId}`, categoryId, categoryName: 'Checkout proof', priceUgx: 100_000, approvalStatus: 'approved', hasRetailPrice: true, stockQuantity: 10 });
    await db.insert(productPrices).values({ productId, retailPrice: 100_000 });

    const pricingRepo = new DrizzlePricingRepository();
    const quoteRepo = new DrizzlePricingQuoteRepository();
    const capacity = new ManagePromotionCapacityUseCase(new DrizzlePricingCapacityRepository());
    const governance = new PricingGovernanceUseCase(pricingRepo, new CreateAuditLogUseCase(new DrizzleAuditRepository()));
    const evaluator = new EvaluateCartPricingUseCase(new DrizzleProductRepository(), pricingRepo, quoteRepo);
    const orderRepo = new DrizzleOrderRepository();
    const paymentRepo = new DrizzlePaymentAttemptRepository();
    const provider = new ControlledPesaPal();
    const now = new Date();
    const created = await governance.create({
      key: `p4-checkout-${randomUUID()}`,
      name: 'P4 checkout proof',
      description: 'Self-cleaning authoritative checkout proof',
      actorId,
      version: { conditions: [], benefits: [{ type: 'PERCENTAGE_OFF', value: 1000 }], exclusions: [], schedule: { startsAt: new Date(now.getTime() - 60_000), endsAt: new Date(now.getTime() + 3_600_000) }, usagePolicy: { globalLimit: 100, perCustomerLimit: 10, perCouponLimit: null, reservationTtlSeconds: 900 }, priority: 10, stackable: false, couponCode: null, priceFloorUgx: 1 },
    });
    definitionIds.push(created.definition.id);
    const ready = await governance.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: 1, to: 'READY_FOR_REVIEW', actorId, reason: 'P4 proof review', now });
    const approved = await governance.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: ready.definition.revision, to: 'APPROVED', actorId, reason: 'P4 proof approval', now });
    const active = await governance.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: approved.definition.revision, to: 'ACTIVE', actorId, reason: 'P4 proof activation', now });

    const checkout = new CheckoutUseCase(orderRepo, new DrizzleProductRepository(), null, { evaluator, capacity, quotes: quoteRepo, orders: orderRepo });
    const checkoutInput = {
      customerDetails: { name: 'P4 Proof Customer', email: 'p4-proof@example.invalid', phone: '0700000000', deliveryArea: 'Kampala', deliveryAddress: 'Proof address' },
      buyerType: 'retail' as const,
      items: [{ productId, quantity: 2, price: 1, name: 'browser-tampering' } as any],
      clientOrderKey: `p4-${randomUUID()}`,
    };
    const first = await checkout.execute(checkoutInput);
    orderIds.push(first.order.id);
    const replay = await checkout.execute(checkoutInput);
    assert(replay.idempotentReplay && replay.order.id === first.order.id, 'checkout idempotency did not return the committed order');
    assert(first.order.totalUgx === 180_000 && first.order.items[0].price === 100_000, 'browser input influenced authoritative checkout');
    assert(first.order.pricingSnapshot?.discountTotalUgx === 20_000 && first.order.pricingSnapshot.finalTotalUgx === first.order.totalUgx, 'immutable pricing snapshot mismatch');

    const [stored] = await db.select().from(orders).where(eq(orders.id, first.order.id));
    const storedLines = await db.select().from(orderItems).where(eq(orderItems.orderId, first.order.id));
    const reservations = await db.select().from(promotionReservations).where(eq(promotionReservations.quoteId, first.order.pricingSnapshot!.quoteId));
    const redemptions = reservations.length ? await db.select().from(promotionRedemptions).where(inArray(promotionRedemptions.reservationId, reservations.map((row) => row.id))) : [];
    assert(stored.pricingQuoteId === first.order.pricingSnapshot!.quoteId && stored.pricingCalculationVersion === 'pricing-v1', 'order quote provenance was not persisted');
    assert(storedLines.length === 1 && storedLines[0].canonicalUnitPrice === 100_000 && storedLines[0].discountAmount === 20_000 && storedLines[0].finalLineTotal === 180_000, 'order line breakdown was not persisted');
    assert(reservations.length === 1 && reservations[0].status === 'REDEEMED' && redemptions.length === 1 && redemptions[0].orderId === first.order.id, 'order and redemption did not commit atomically');

    let persistenceFailure = false;
    try {
      await checkout.execute({ ...checkoutInput, clientOrderKey: `p4-failure-${randomUUID()}`, customerDetails: { ...checkoutInput.customerDetails, name: 'X'.repeat(300) } });
    } catch { persistenceFailure = true; }
    assert(persistenceFailure, 'deliberate persistence failure did not fail');
    const productQuoteRows = await db.select({ id: pricingQuotes.id }).from(pricingQuotes).innerJoin(pricingQuoteLines, eq(pricingQuoteLines.quoteId, pricingQuotes.id)).where(eq(pricingQuoteLines.productId, productId));
    quoteIds = [...new Set(productQuoteRows.map((row) => row.id))];
    const failedReservations = await db.select().from(promotionReservations).where(inArray(promotionReservations.quoteId, quoteIds.filter((id) => id !== first.order.pricingSnapshot!.quoteId)));
    assert(failedReservations.length === 1 && failedReservations[0].status === 'RELEASED', 'pre-order failure did not compensate its reservation');

    const startPayment = new StartPesaPalPaymentUseCase(paymentRepo, orderRepo, provider);
    const paymentOne = await startPayment.execute({ orderId: first.order.id });
    await startPayment.execute({ orderId: first.order.id });
    assert(provider.submissions.length === 2 && provider.submissions.every((call) => call.amount === 180_000 && call.currency === 'UGX'), 'PesaPal retries did not use the immutable attempt amount');
    const verified = await new VerifyPesaPalPaymentUseCase(paymentRepo, provider, new OrderTransitionService()).execute({ orderTrackingId: 'proof-tracking-2', merchantReference: paymentOne.merchantReference, source: 'callback' });
    assert(verified.ok && verified.amount === 180_000, 'authoritative payment verification failed');
    const paidOrder = await orderRepo.findById(first.order.id);
    assert(paidOrder?.paymentStatus === 'paid' && paidOrder.pricingSnapshot?.finalTotalUgx === 180_000, 'payment update changed immutable pricing evidence');

    await governance.transition({ definitionId: created.definition.id, versionId: created.version.id, expectedRevision: active.definition.revision, to: 'PAUSED', actorId, reason: 'P4 proof complete', now: new Date() });
    const [{ count: outboxAfter }] = await db.select({ count: sql<number>`count(*)::int` }).from(outboxEvents);
    assert(outboxAfter === outboxBefore, 'checkout proof mutated the communication outbox');
    report = { canonicalCatalogueUnitPriceUgx: 100_000, browserProvidedUnitPriceUgx: 1, authoritativeOrderTotalUgx: 180_000, immutableOrderSnapshot: true, atomicRedemptions: redemptions.length, idempotentOrderRows: 1, compensatedReservations: failedReservations.length, pesapalAttemptAmountUgx: 180_000, controlledProviderSubmitCalls: provider.submissions.length, controlledProviderStatusCalls: provider.statusCalls, realProviderCalls: 0, outboxMutation: 0 };
  } catch (error) { failure = error; }
  finally {
    try {
      if (orderIds.length) await db.delete(paymentAttempts).where(inArray(paymentAttempts.orderId, orderIds));
      if (quoteIds.length) {
        const reservations = await db.select({ id: promotionReservations.id }).from(promotionReservations).where(inArray(promotionReservations.quoteId, quoteIds));
        if (reservations.length) await db.delete(promotionRedemptions).where(inArray(promotionRedemptions.reservationId, reservations.map((row) => row.id)));
        await db.delete(promotionReservations).where(inArray(promotionReservations.quoteId, quoteIds));
      }
      if (orderIds.length) { await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds)); await db.delete(orders).where(inArray(orders.id, orderIds)); }
      if (quoteIds.length) { await db.delete(pricingAdjustments).where(inArray(pricingAdjustments.quoteId, quoteIds)); await db.delete(pricingQuoteLines).where(inArray(pricingQuoteLines.quoteId, quoteIds)); await db.delete(pricingQuotes).where(inArray(pricingQuotes.id, quoteIds)); }
      if (definitionIds.length) {
        await db.update(promotionDefinitions).set({ activeVersionId: null }).where(inArray(promotionDefinitions.id, definitionIds));
        const versions = await db.select({ id: promotionVersions.id }).from(promotionVersions).where(inArray(promotionVersions.definitionId, definitionIds));
        if (versions.length) await db.delete(promotionApprovals).where(inArray(promotionApprovals.versionId, versions.map((row) => row.id)));
        await db.delete(auditLogs).where(inArray(auditLogs.entityId, definitionIds));
        await db.delete(promotionVersions).where(inArray(promotionVersions.definitionId, definitionIds));
        await db.delete(promotionDefinitions).where(inArray(promotionDefinitions.id, definitionIds));
      }
      await db.delete(productPrices).where(eq(productPrices.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
      await db.delete(categories).where(eq(categories.id, categoryId));
      const orderResidue = orderIds.length ? await db.select({ id: orders.id }).from(orders).where(inArray(orders.id, orderIds)) : [];
      const quoteResidue = await db.select({ id: pricingQuoteLines.id }).from(pricingQuoteLines).where(eq(pricingQuoteLines.productId, productId));
      const productResidue = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
      report.proofResidue = orderResidue.length + quoteResidue.length + productResidue.length;
      if (report.proofResidue !== 0) failure ??= new Error('PRICING_P4_PROOF_RESIDUE');
    } catch (error) { failure ??= error; }
    if (previousIpn === undefined) delete process.env.PESAPAL_IPN_ID; else process.env.PESAPAL_IPN_ID = previousIpn;
    try { await endDbConnection(); } catch (error) { failure ??= error; }
  }
  console.log(JSON.stringify({ ...report, verdict: failure ? 'FAIL' : 'PASS' }));
  if (failure) throw failure;
}

main().catch((error) => { console.error('PRICING_CHECKOUT_PROOF_ERROR', error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
