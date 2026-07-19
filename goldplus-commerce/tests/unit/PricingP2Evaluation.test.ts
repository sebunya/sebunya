import { describe, expect, it } from 'vitest';
import { evaluatePricing, EvaluatePricingInput, PricingRule } from '../../apps/api/src/domain/pricing/PricingEvaluator';
import { EvaluateCartPricingUseCase } from '../../apps/api/src/application/use-cases/pricing/EvaluateCartPricingUseCase';

const now = new Date('2026-07-20T00:00:00Z');
const rule = (id: string, overrides: Partial<PricingRule> = {}): PricingRule => ({
  definitionId: id,
  definitionKey: id,
  versionId: `${id}-v1`,
  versionNumber: 1,
  conditions: [],
  benefits: [{ type: 'PERCENTAGE_OFF', value: 1000 }],
  exclusions: [],
  schedule: { startsAt: new Date('2026-07-01T00:00:00Z'), endsAt: new Date('2026-08-01T00:00:00Z') },
  usagePolicy: { globalLimit: null, perCustomerLimit: null, perCouponLimit: null, reservationTtlSeconds: 900 },
  priority: 10,
  stackable: true,
  couponCode: null,
  priceFloorUgx: 0,
  ...overrides,
});
const input = (rules: PricingRule[]): EvaluatePricingInput => ({
  quoteId: 'quote-1',
  lines: [
    { productId: 'p2', sku: 'P2', name: 'Two', category: 'B', canonicalUnitPriceUgx: 500, quantity: 1 },
    { productId: 'p1', sku: 'P1', name: 'One', category: 'A', canonicalUnitPriceUgx: 1000, quantity: 2 },
  ],
  rules,
  couponCode: null,
  couponReference: null,
  customerDnaSegments: [],
  experimentEvidence: [],
  shippingUgx: 200,
  taxUgx: 0,
  evaluatedAt: now,
  expiresAt: new Date(now.getTime() + 300_000),
});

describe('Pricing P2 deterministic evaluation', () => {
  it('sorts rules explicitly, applies stackable rules, then closes on an exclusive rule', () => {
    const percentage = rule('b', { priority: 20 });
    const fixed = rule('a', { priority: 10, stackable: false, benefits: [{ type: 'FIXED_AMOUNT_OFF', value: 100, targetProductIds: ['p1'] }] });
    const shipping = rule('c', { priority: 1, benefits: [{ type: 'FREE_SHIPPING', value: 0 }] });
    const first = evaluatePricing(input([shipping, fixed, percentage]));
    const second = evaluatePricing(input([percentage, shipping, fixed]));
    expect(first).toEqual(second);
    expect(first.baseSubtotalUgx).toBe(2500);
    expect(first.discountTotalUgx).toBe(350);
    expect(first.finalTotalUgx).toBe(2350);
    expect(first.appliedPromotionVersions.map((item) => item.definitionId)).toEqual(['b', 'a']);
    expect(first.excludedCandidates).toContainEqual(expect.objectContaining({ promotionDefinitionId: 'c', reason: 'STACKING_CONFLICT' }));
    expect(first.lines.map((line) => line.productId)).toEqual(['p1', 'p2']);
  });

  it('returns explicit qualification and exclusion reasons without applying hidden discounts', () => {
    const rules = [
      rule('coupon', { couponCode: 'SAVE10' }),
      rule('category', { conditions: [{ type: 'CATEGORY_INCLUDED', value: 'missing' }] }),
      rule('segment', { exclusions: [{ type: 'CUSTOMER_DNA_SEGMENT', value: 'RISK' }] }),
      rule('experiment', { conditions: [{ type: 'EXPERIMENT_VARIANT', value: 'exp-1:treatment' }] }),
      rule('expired', { schedule: { startsAt: new Date('2026-06-01'), endsAt: new Date('2026-07-01') } }),
    ];
    const quote = evaluatePricing({ ...input(rules), customerDnaSegments: ['RISK'] });
    expect(quote.discountTotalUgx).toBe(0);
    expect(Object.fromEntries(quote.decisionTrace.map((item) => [item.promotionDefinitionId, item.reason]))).toEqual({
      coupon: 'COUPON_REQUIRED',
      category: 'CATEGORY_NOT_INCLUDED',
      segment: 'EXCLUDED_CUSTOMER_SEGMENT',
      experiment: 'EXPERIMENT_VARIANT_NOT_MET',
      expired: 'INACTIVE_WINDOW',
    });
  });

  it('enforces integer rounding, caps and price floors', () => {
    const floorRule = rule('floor', { benefits: [{ type: 'PERCENTAGE_OFF', value: 3333, maximumDiscountUgx: 10_000 }], priceFloorUgx: 900, stackable: false });
    const quote = evaluatePricing(input([floorRule]));
    expect(quote.lines.find((line) => line.productId === 'p1')?.discountUgx).toBe(200);
    expect(quote.lines.find((line) => line.productId === 'p2')?.discountUgx).toBe(0);
    expect(quote.finalTotalUgx).toBe(2500);
    expect(quote.lines.every((line) => line.finalSubtotalUgx >= 0)).toBe(true);
  });

  it('reloads canonical catalogue prices and supports a non-persistent simulation', async () => {
    let saved = 0;
    const products: any = { findPublicViewList: async () => [{ entity: { id: 'p1', sku: 'P1', name: 'Canonical', category: 'A' }, retailPriceUgx: 4000, categoryName: 'A' }] };
    const pricing: any = { listActiveVersions: async () => [] };
    const quotes: any = { saveQuote: async () => { saved += 1; } };
    const useCase = new EvaluateCartPricingUseCase(products, pricing, quotes);
    const simulated = await useCase.execute({ items: [{ productId: 'p1', quantity: 2 }], shippingUgx: 500, persist: false, evaluatedAt: now });
    expect(simulated.baseSubtotalUgx).toBe(8000);
    expect(simulated.finalTotalUgx).toBe(8500);
    expect(saved).toBe(0);
    const persisted = await useCase.execute({ items: [{ productId: 'p1', quantity: 2 }], persist: true, evaluatedAt: now });
    expect(persisted.currency).toBe('UGX');
    expect(saved).toBe(1);
  });
});
