import { describe, expect, it } from 'vitest';
import { EvaluateCartPricingUseCase, PricingEvaluationError } from '../../apps/api/src/application/use-cases/pricing/EvaluateCartPricingUseCase';
import { classifyDependencyError, isTerminalDependencyCode } from '../../apps/api/src/application/ports/CheckoutDependencyOutcomes';
import { customerMessageFor } from '../../apps/web/src/lib/checkoutClient';

/**
 * A used-up promotion, a refused pay-on-delivery and a points refusal were thrown as messages nothing classified:
 * CHECKOUT_ERROR, FAILED_RETRYABLE, 503 "Please try again", on every retry. And pricing never looked at usage
 * limits, so an exhausted automatic promotion stayed in every total and blocked every qualifying checkout.
 */
describe('checkout refusals a retry cannot fix are named, final and explained', () => {
  const cases: Array<[unknown, string]> = [
    [new Error('PROMOTION_GLOBAL_LIMIT_REACHED'), 'PROMOTION_LIMIT_REACHED'],
    [new Error('PROMOTION_CUSTOMER_LIMIT_REACHED'), 'PROMOTION_LIMIT_REACHED'],
    [new Error('PROMOTION_COUPON_LIMIT_REACHED'), 'PROMOTION_LIMIT_REACHED'],
    [new Error('PROMOTION_NOT_ACTIVE'), 'PROMOTION_CHANGED'],
    [new Error('COD_NOT_AVAILABLE: Pay on delivery is not available for this destination'), 'PAY_ON_DELIVERY_UNAVAILABLE'],
    [new Error('COD_LIMIT_EXCEEDED: Orders above 2,000,000 UGX'), 'PAY_ON_DELIVERY_UNAVAILABLE'],
    [new PricingEvaluationError('PRODUCT_UNAVAILABLE', 'A requested product is not available.'), 'PRODUCT_UNAVAILABLE'],
    [new PricingEvaluationError('PRICE_UNAVAILABLE', 'no price'), 'PRICE_UNAVAILABLE'],
  ];
  it.each(cases)('%s is classified as %s, which is terminal', (error, code) => {
    const c = classifyDependencyError(error);
    expect(c?.code).toBe(code);
    expect(isTerminalDependencyCode(c!.code)).toBe(true);
  });

  it('an unknown failure stays unclassified (retryable), and a coded error with an unknown code too', () => {
    expect(classifyDependencyError(new Error('connection reset'))).toBeNull();
    expect(classifyDependencyError(new PricingEvaluationError('INVALID_BASKET', 'x'))).toBeNull();
  });

  it('the storefront explains each one, and none says "Please try again"', () => {
    for (const code of ['PROMOTION_LIMIT_REACHED', 'PAY_ON_DELIVERY_UNAVAILABLE', 'LOYALTY_REDEMPTION_REFUSED']) {
      const m = customerMessageFor({ ok: false, code, message: '' } as never);
      expect(m.status, code).toBe('error');
      expect(m.message, code).not.toMatch(/please try again\./i);
      expect(m.message, code).toMatch(/not been charged/);
    }
    expect(customerMessageFor({ ok: false, code: 'PAY_ON_DELIVERY_UNAVAILABLE', message: '' } as never).message).toMatch(/pay online/i);
  });
});

describe('pricing leaves out a promotion whose usage limit is used up', () => {
  const products: any = { findPublicViewList: async () => [{ entity: { id: 'p1', sku: 'P1', name: 'Battery', category: 'A' }, retailPriceUgx: 100_000, floorPriceUgx: 50_000, categoryName: 'A' }] };
  const version = (id: string) => ({
    definition: { id: `d-${id}`, key: id },
    version: { id, versionNumber: 1, conditions: [], benefits: [{ type: 'FIXED_AMOUNT_OFF', value: 10_000 }], exclusions: [], schedule: { startsAt: new Date('2026-01-01'), endsAt: new Date('2027-01-01') }, usagePolicy: {}, priority: 1, stackable: true, couponCode: null, priceFloorUgx: null },
  });
  const pricing: any = { listActiveVersions: async () => [version('full'), version('open')] };
  const quotes: any = { saveQuote: async () => undefined };

  it('the exhausted version is not applied; the open one is', async () => {
    const asked: unknown[] = [];
    const capacity = { exhaustedVersionIds: async (i: unknown) => { asked.push(i); return new Set(['full']); } };
    const quote = await new EvaluateCartPricingUseCase(products, pricing, quotes, capacity).execute({ items: [{ productId: 'p1', quantity: 1 }], persist: false, evaluatedAt: new Date('2026-10-15T08:00:00Z') });
    expect(quote.appliedPromotionVersions.map((v) => v.versionId)).toEqual(['open']);
    expect(quote.discountTotalUgx).toBe(10_000);
    expect(asked[0]).toMatchObject({ versionIds: ['full', 'open'], couponReferenceHash: null });
  });

  it('with no capacity reader (hermetic suites), nothing is left out', async () => {
    const quote = await new EvaluateCartPricingUseCase(products, pricing, quotes).execute({ items: [{ productId: 'p1', quantity: 1 }], persist: false, evaluatedAt: new Date('2026-10-15T08:00:00Z') });
    expect(quote.appliedPromotionVersions).toHaveLength(2);
  });
});
