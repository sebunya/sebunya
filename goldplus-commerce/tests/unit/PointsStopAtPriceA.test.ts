import { describe, expect, it, vi } from 'vitest';
import { CheckoutUseCase } from '../../apps/api/src/application/use-cases/commerce/CheckoutUseCase';
import { Order } from '../../apps/api/src/domain/commerce/Order';
import { PricingQuote } from '../../apps/api/src/domain/pricing/PricingEvaluator';

/**
 * Owner, 2026-10-15: loyalty points may not take an order below its products' Price A. Checkout hands the points
 * reservation the Price A total of the lines that HAVE one (a product with no Price A adds nothing), and the
 * planner refuses beyond it (LoyaltyCompletionEngine.test.ts).
 */
const now = new Date('2026-10-15T08:00:00Z');
const quote: PricingQuote = {
  id: '11111111-1111-4111-8111-111111111111', currency: 'UGX',
  lines: [
    { productId: 'battery', sku: 'B', name: 'Battery', category: 'Power', canonicalUnitPriceUgx: 160_000, quantity: 1, floorUnitPriceUgx: 145_000, priceAUnitUgx: 145_000, baseSubtotalUgx: 160_000, discountUgx: 0, finalSubtotalUgx: 160_000 },
    { productId: 'cable', sku: 'C', name: 'Cable', category: 'Cables', canonicalUnitPriceUgx: 20_000, quantity: 2, floorUnitPriceUgx: 20_000, priceAUnitUgx: null, baseSubtotalUgx: 40_000, discountUgx: 0, finalSubtotalUgx: 40_000 },
  ],
  baseSubtotalUgx: 200_000, adjustments: [], excludedCandidates: [], discountTotalUgx: 0, shippingUgx: 0, taxUgx: 0, finalTotalUgx: 200_000,
  appliedPromotionVersions: [], couponReference: null, experimentEvidence: [], calculationVersion: 'pricing-v1', evaluatedAt: now,
  expiresAt: new Date(now.getTime() + 300_000), decisionTrace: [],
};

describe('checkout asks the points reservation to stop at Price A', () => {
  it('passes the Price A total of the lines that have one (145,000; the cable has none)', async () => {
    const reserve = vi.fn().mockResolvedValue({ ok: false, code: 'BELOW_PRICE_FLOOR', message: 'x' });
    const orders: any = { findById: async () => null, findByClientKey: async () => null, save: async () => undefined, savePricedOrder: async ({ order }: { order: Order }) => ({ order, duplicate: false }) };
    const uc = new CheckoutUseCase(orders, {} as any, null, {
      evaluator: { execute: vi.fn().mockResolvedValue(quote) } as any,
      quotes: { saveQuote: vi.fn(), findQuote: vi.fn() } as any,
      capacity: { reserve: vi.fn().mockResolvedValue({ reservations: [], duplicate: false }), release: vi.fn() } as any,
      orders,
    }, null, null, { reserve, attach: vi.fn(), release: vi.fn() });
    await expect(uc.execute({
      customerDetails: { name: 'A', phone: '0772000000', deliveryArea: 'Kampala', deliveryAddress: 'Plot 1' },
      buyerType: 'retail',
      items: [{ productId: 'battery', quantity: 1 }, { productId: 'cable', quantity: 2 }],
      principal: { kind: 'USER', id: '00000000-0000-4000-8000-000000000001' },
      redeemPoints: 2_000,
      clientOrderKey: 'points-floor',
    } as any)).rejects.toThrow(/BELOW_PRICE_FLOOR/);
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ orderGoodsTotalUgx: 200_000, orderFloorTotalUgx: 145_000 }));
  });
});
