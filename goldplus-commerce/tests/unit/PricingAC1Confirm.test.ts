import { describe, expect, it } from 'vitest';
import { evaluatePricing, EvaluatePricingInput, PricingRule } from '../../apps/api/src/domain/pricing/PricingEvaluator';

const now = new Date('2026-07-20T00:00:00Z');

describe('U1 AC1 — a 10% promotion on a 100,000 UGX cart yields 90,000', () => {
  it('computes 90,000 through the canonical engine', () => {
    const rule: PricingRule = {
      definitionId: 'tenpct',
      definitionKey: 'tenpct',
      versionId: 'tenpct-v1',
      versionNumber: 1,
      conditions: [],
      benefits: [{ type: 'PERCENTAGE_OFF', value: 1000 }], // 1000 bps = 10%
      exclusions: [],
      schedule: { startsAt: new Date('2026-07-01T00:00:00Z'), endsAt: new Date('2026-08-01T00:00:00Z') },
      usagePolicy: { globalLimit: null, perCustomerLimit: null, perCouponLimit: null, reservationTtlSeconds: 900 },
      priority: 10,
      stackable: false,
      couponCode: null,
      priceFloorUgx: 0,
    };
    const input: EvaluatePricingInput = {
      quoteId: 'q1',
      lines: [{ productId: 'p1', sku: 'P1', name: 'Item', category: 'A', canonicalUnitPriceUgx: 100_000, quantity: 1 }],
      rules: [rule],
      couponCode: null,
      couponReference: null,
      customerDnaSegments: [],
      experimentEvidence: [],
      shippingUgx: 0,
      taxUgx: 0,
      evaluatedAt: now,
      expiresAt: new Date(now.getTime() + 300_000),
    };

    const quote = evaluatePricing(input);

    expect(quote.baseSubtotalUgx).toBe(100_000);
    expect(quote.discountTotalUgx).toBe(10_000);
    expect(quote.finalTotalUgx).toBe(90_000);
    expect(quote.appliedPromotionVersions.map((p) => p.definitionId)).toEqual(['tenpct']);
    // The line-level replay reproduces the same total (persistence match is
    // covered separately by the checkout-integrity snapshot test).
    const replay = quote.lines.reduce((sum, l) => sum + l.finalSubtotalUgx, 0) + quote.shippingUgx + quote.taxUgx;
    expect(replay).toBe(90_000);
  });
});
