import { describe, expect, it, vi } from 'vitest';
import { CheckoutUseCase } from '../../apps/api/src/application/use-cases/commerce/CheckoutUseCase';
import { Order } from '../../apps/api/src/domain/commerce/Order';
import { PricingQuote } from '../../apps/api/src/domain/pricing/PricingEvaluator';

/**
 * The quote behind the "Apply" button lives 300 s. Checkout refused ANY preview
 * past that age as PRICE_CHANGED, so a coupon applied more than five minutes
 * before "Place order" (a slow phone, a long form, even for pickup) was refused
 * with "a price changed" that was not true, and the re-rendered page dropped the
 * code so the retry was charged full price. An expired preview is now compared by
 * content; only a missing one, or one whose content really moved, is refused.
 */

const now = new Date('2026-07-20T10:00:00.000Z');

function quote(overrides: Partial<PricingQuote> = {}): PricingQuote {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    currency: 'UGX',
    lines: [{ productId: 'product-1', sku: 'SKU-1', name: 'Product', category: 'Tyres', canonicalUnitPriceUgx: 100_000, quantity: 2, baseSubtotalUgx: 200_000, discountUgx: 20_000, finalSubtotalUgx: 180_000 }],
    baseSubtotalUgx: 200_000,
    adjustments: [],
    excludedCandidates: [],
    discountTotalUgx: 20_000,
    shippingUgx: 10_000,
    taxUgx: 0,
    finalTotalUgx: 190_000,
    appliedPromotionVersions: [{ definitionId: 'definition-1', versionId: 'version-1', versionNumber: 1 }],
    couponReference: 'GOLD10',
    experimentEvidence: [],
    calculationVersion: 'pricing-v1',
    evaluatedAt: now,
    expiresAt: new Date(now.getTime() + 300_000),
    decisionTrace: [],
    ...overrides,
  };
}

const customer = { name: 'Coupon Customer', email: 'coupon@example.com', phone: '0700000000', deliveryArea: 'Kampala', deliveryAddress: 'Plot 1' };

function harness(current: PricingQuote, preview: PricingQuote | null) {
  const saved: Order[] = [];
  const orders: any = {
    findById: async (id: string) => saved.find((order) => order.id === id) ?? null,
    findByClientKey: async () => null,
    save: async () => undefined,
    savePricedOrder: async ({ order }: { order: Order }) => { saved.push(order); return { order, duplicate: false }; },
  };
  const useCase = new CheckoutUseCase(orders, {} as any, null, {
    evaluator: { execute: vi.fn().mockResolvedValue(current) } as any,
    quotes: { saveQuote: vi.fn(), findQuote: vi.fn().mockResolvedValue(preview) },
    capacity: {
      reserve: vi.fn().mockResolvedValue({ reservations: [{ id: 'reservation-1' }], duplicate: false }),
      release: vi.fn().mockResolvedValue({ reservationIds: ['reservation-1'], duplicate: false }),
    } as any,
    orders,
  });
  return { useCase, saved };
}

// Applied six minutes before checkout, priced without delivery (as the Apply button does).
const sixMinutesEarlier = new Date(now.getTime() - 6 * 60_000);
const stalePreview = (over: Partial<PricingQuote> = {}) => quote({
  id: '22222222-2222-4222-8222-222222222222',
  shippingUgx: 0,
  finalTotalUgx: 180_000,
  evaluatedAt: sixMinutesEarlier,
  expiresAt: new Date(sixMinutesEarlier.getTime() + 300_000),
  ...over,
});

const place = (useCase: CheckoutUseCase, key: string) => useCase.execute({
  customerDetails: customer,
  buyerType: 'retail',
  items: [{ productId: 'product-1', quantity: 2 }],
  couponCode: 'GOLD10',
  previewQuoteId: '22222222-2222-4222-8222-222222222222',
  clientOrderKey: key,
});

describe('a coupon applied more than five minutes ago still checks out', () => {
  it('an expired preview with unchanged content creates the order with the discount', async () => {
    const { useCase, saved } = harness(quote(), stalePreview());
    const result = await place(useCase, 'coupon-expired-unchanged');
    expect(result.order.totalUgx).toBe(190_000);
    expect(result.order.pricingSnapshot?.discountTotalUgx).toBe(20_000);
    expect(saved).toHaveLength(1);
  });

  it('an expired preview whose discount really changed is still refused', async () => {
    const { useCase, saved } = harness(quote(), stalePreview({ discountTotalUgx: 30_000, finalTotalUgx: 170_000 }));
    await expect(place(useCase, 'coupon-expired-changed')).rejects.toThrow('PROMOTION_CHANGED');
    expect(saved).toHaveLength(0);
  });

  it('a preview that cannot be found is refused', async () => {
    const { useCase } = harness(quote(), null);
    await expect(place(useCase, 'coupon-missing')).rejects.toThrow('PRICE_CHANGED');
  });
});
