import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckoutUseCase } from '../../apps/api/src/application/use-cases/commerce/CheckoutUseCase';
import { StartPesaPalPaymentUseCase } from '../../apps/api/src/application/use-cases/payments/StartPesaPalPaymentUseCase';
import { Order } from '../../apps/api/src/domain/commerce/Order';
import { PricingQuote } from '../../apps/api/src/domain/pricing/PricingEvaluator';

const now = new Date('2026-07-20T10:00:00.000Z');

function quote(overrides: Partial<PricingQuote> = {}): PricingQuote {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    currency: 'UGX',
    lines: [{ productId: 'product-1', sku: 'CANONICAL-SKU', name: 'Canonical product', category: 'Tyres', canonicalUnitPriceUgx: 100_000, quantity: 2, baseSubtotalUgx: 200_000, discountUgx: 20_000, finalSubtotalUgx: 180_000 }],
    baseSubtotalUgx: 200_000,
    adjustments: [{ scope: 'LINE', productId: 'product-1', promotionDefinitionId: 'definition-1', promotionVersionId: 'version-1', benefitType: 'PERCENTAGE_OFF', amountUgx: 20_000, applicationOrder: 0, explanation: 'Approved promotion applied.' }],
    excludedCandidates: [],
    discountTotalUgx: 20_000,
    shippingUgx: 5_000,
    taxUgx: 0,
    finalTotalUgx: 185_000,
    appliedPromotionVersions: [{ definitionId: 'definition-1', versionId: 'version-1', versionNumber: 1 }],
    couponReference: null,
    experimentEvidence: [],
    calculationVersion: 'pricing-v1',
    evaluatedAt: now,
    expiresAt: new Date(now.getTime() + 300_000),
    decisionTrace: [{ promotionDefinitionId: 'definition-1', promotionVersionId: 'version-1', outcome: 'APPLIED', reason: 'QUALIFIED' }],
    ...overrides,
  };
}

const customer = { name: 'Pricing Customer', email: 'pricing@example.com', phone: '0700000000', deliveryArea: 'Kampala', deliveryAddress: 'Plot 1' };

function harness(currentQuote = quote()) {
  const saved: Order[] = [];
  const calls = { reserve: 0, release: 0, save: 0 };
  const orders: any = {
    findById: async (id: string) => saved.find((order) => order.id === id) ?? null,
    findByClientKey: async () => null,
    save: async () => undefined,
    savePricedOrder: async ({ order }: { order: Order }) => { calls.save += 1; saved.push(order); return { order, duplicate: false }; },
  };
  const useCase = new CheckoutUseCase(orders, {} as any, null, {
    evaluator: { execute: vi.fn().mockResolvedValue(currentQuote) } as any,
    quotes: { saveQuote: vi.fn(), findQuote: vi.fn().mockResolvedValue(null) },
    capacity: {
      reserve: vi.fn().mockImplementation(async () => { calls.reserve += 1; return { reservations: [{ id: 'reservation-1' }], duplicate: false }; }),
      release: vi.fn().mockImplementation(async () => { calls.release += 1; return { reservationIds: ['reservation-1'], duplicate: false }; }),
    } as any,
    orders,
  });
  return { useCase, orders, saved, calls };
}

describe('Pricing P4 authoritative checkout and payment integrity', () => {
  afterEach(() => { delete process.env.PESAPAL_IPN_ID; });

  it('creates the order exclusively from the canonical quote and records its immutable breakdown', async () => {
    const { useCase, saved } = harness();
    const result = await useCase.execute({
      customerDetails: customer,
      buyerType: 'retail',
      items: [{ productId: 'product-1', quantity: 2, price: 1, name: 'tampered' } as any],
      clientOrderKey: 'pricing-checkout-1',
    });
    expect(result.order.totalUgx).toBe(185_000);
    expect(result.order.items[0]).toMatchObject({ sku: 'CANONICAL-SKU', price: 100_000, discountAmount: 20_000, finalLineTotal: 180_000 });
    expect(result.order.pricingSnapshot).toMatchObject({ quoteId: quote().id, baseSubtotalUgx: 200_000, discountTotalUgx: 20_000, finalTotalUgx: 185_000, calculationVersion: 'pricing-v1' });
    expect(saved).toHaveLength(1);
  });

  it('requires explicit acceptance when canonical price or promotion evidence changed since preview', async () => {
    const current = quote();
    const preview = quote({ id: '22222222-2222-4222-8222-222222222222', finalTotalUgx: 195_000, discountTotalUgx: 10_000 });
    const { useCase, calls } = harness(current);
    (useCase as any).authoritativePricing.quotes.findQuote = vi.fn().mockResolvedValue(preview);
    await expect(useCase.execute({ customerDetails: customer, buyerType: 'retail', items: [{ productId: 'product-1', quantity: 2 }], previewQuoteId: preview.id })).rejects.toThrow('PROMOTION_CHANGED');
    expect(calls).toEqual({ reserve: 0, release: 0, save: 0 });
  });

  it('releases capacity when atomic order persistence fails before an order exists', async () => {
    const { useCase, orders, calls } = harness();
    orders.savePricedOrder = vi.fn().mockRejectedValue(new Error('ORDER_PERSISTENCE_FAILED'));
    await expect(useCase.execute({ customerDetails: customer, buyerType: 'retail', items: [{ productId: 'product-1', quantity: 2 }] })).rejects.toThrow('ORDER_PERSISTENCE_FAILED');
    expect(calls.reserve).toBe(1);
    expect(calls.release).toBe(1);
    expect(calls.save).toBe(0);
  });

  it('submits every PesaPal retry from the immutable recorded attempt amount', async () => {
    process.env.PESAPAL_IPN_ID = 'proof-ipn';
    const order = new Order('order-1', 'GP-1001', 'Pricing Customer', '0700000000', 'pricing@example.com', 'Kampala', 'Plot 1', 'retail', [], 1, 0, 1, 'unpaid', 'received', now, now);
    const attempt = { id: 'attempt-1', orderId: order.id, merchantReference: 'GP-GP-1001-order-1', amount: 185_000, currency: 'UGX', status: 'pending' };
    const paymentRepo: any = { findByMerchantReference: vi.fn().mockResolvedValue(attempt), createPaymentAttempt: vi.fn(), updatePaymentAttemptStatus: vi.fn() };
    const provider: any = { submitOrderRequest: vi.fn().mockResolvedValue({ order_tracking_id: 'tracking-1', merchant_reference: attempt.merchantReference, redirect_url: 'https://example.invalid/payment' }) };
    const useCase = new StartPesaPalPaymentUseCase(paymentRepo, { findById: vi.fn().mockResolvedValue(order) } as any, provider);
    await useCase.execute({ orderId: order.id });
    expect(provider.submitOrderRequest).toHaveBeenCalledWith(expect.objectContaining({ amount: 185_000, currency: 'UGX' }));
    expect(paymentRepo.createPaymentAttempt).not.toHaveBeenCalled();
  });
});
