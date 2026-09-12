import { describe, it, expect } from 'vitest';
import { evaluatePricing, type EvaluatePricingInput, type PricingRule, type CanonicalPricingLine } from '../../apps/api/src/domain/pricing/PricingEvaluator';

/**
 * PricingEvaluator holds two copies of the discount arithmetic: the read-only
 * estimator that RANKS competing exclusive promotions, and the application
 * inside runPass that CHARGES. If they ever drift, the wrong exclusive
 * promotion wins — a ranking defect, never a wrong charge. This matrix pins
 * them together: for every case, the exclusive rule that wins must be the one
 * whose standalone application produces the larger discount.
 */
const now = new Date('2026-07-15T12:00:00Z');
const rule = (id: string, over: Partial<PricingRule>): PricingRule => ({
  definitionId: id, definitionKey: id, versionId: `${id}-v1`, versionNumber: 1, conditions: [], exclusions: [],
  benefits: [{ type: 'PERCENTAGE_OFF', value: 1000 }],
  schedule: { startsAt: new Date('2026-07-01T00:00:00Z'), endsAt: new Date('2026-08-01T00:00:00Z') },
  usagePolicy: { globalLimit: null, perCustomerLimit: null, perCouponLimit: null, reservationTtlSeconds: 900 },
  priority: 10, stackable: false, couponCode: null, priceFloorUgx: 0, ...over,
});
const line = (id: string, price: number, qty = 1, floor?: number): CanonicalPricingLine =>
  ({ productId: id, sku: id.toUpperCase(), name: id, category: 'A', canonicalUnitPriceUgx: price, quantity: qty, ...(floor != null ? { floorUnitPriceUgx: floor } : {}) } as CanonicalPricingLine);
const input = (lines: CanonicalPricingLine[], rules: PricingRule[]): EvaluatePricingInput => ({
  quoteId: 'q', lines, rules, couponCode: null, couponReference: null, customerDnaSegments: [], experimentEvidence: [],
  shippingUgx: 0, taxUgx: 0, evaluatedAt: now, expiresAt: new Date(now.getTime() + 300_000),
});
const standalone = (lines: CanonicalPricingLine[], r: PricingRule) => evaluatePricing(input(lines, [r])).discountTotalUgx;

type Case = { name: string; lines: CanonicalPricingLine[]; a: Partial<PricingRule>; b: Partial<PricingRule> };
const cases: Case[] = [
  { name: 'no discount vs small', lines: [line('p', 15000)], a: { benefits: [{ type: 'PERCENTAGE_OFF', value: 0 }] }, b: { benefits: [{ type: 'PERCENTAGE_OFF', value: 100 }] } },
  { name: 'minimum non-zero (1 bps floors to 0) vs 10%', lines: [line('p', 15000)], a: { benefits: [{ type: 'PERCENTAGE_OFF', value: 1 }] }, b: { benefits: [{ type: 'PERCENTAGE_OFF', value: 1000 }] } },
  { name: 'maximum 100% vs 50%', lines: [line('p', 15000)], a: { benefits: [{ type: 'PERCENTAGE_OFF', value: 10000 }] }, b: { benefits: [{ type: 'PERCENTAGE_OFF', value: 5000 }] } },
  { name: 'exact price-floor boundary: 10% vs 20% at floor 13500', lines: [line('p', 15000, 1, 13500)], a: { benefits: [{ type: 'PERCENTAGE_OFF', value: 1000 }] }, b: { benefits: [{ type: 'PERCENTAGE_OFF', value: 2000 }] } },
  { name: 'one UGX beyond the floor (floor 13501)', lines: [line('p', 15000, 1, 13501)], a: { benefits: [{ type: 'PERCENTAGE_OFF', value: 1000 }] }, b: { benefits: [{ type: 'FIXED_AMOUNT_OFF', value: 1499 }] } },
  { name: 'rule floor vs line floor (rule floor 14000 wins the max)', lines: [line('p', 15000, 1, 13000)], a: { priceFloorUgx: 14000, benefits: [{ type: 'PERCENTAGE_OFF', value: 5000 }] }, b: { benefits: [{ type: 'PERCENTAGE_OFF', value: 500 }] } },
  { name: 'quantity > 1 with a floor', lines: [line('p', 15000, 3, 13500)], a: { benefits: [{ type: 'PERCENTAGE_OFF', value: 2000 }] }, b: { benefits: [{ type: 'FIXED_AMOUNT_OFF', value: 4000 }] } },
  { name: 'multiple lines, targeted vs untargeted', lines: [line('p', 15000, 2), line('q', 4000, 5, 3500)], a: { benefits: [{ type: 'PERCENTAGE_OFF', value: 1000, targetProductIds: ['q'] }] }, b: { benefits: [{ type: 'PERCENTAGE_OFF', value: 500 }] } },
  { name: 'fixed price vs percentage', lines: [line('p', 15000, 2, 10000)], a: { benefits: [{ type: 'FIXED_PRICE', value: 12000 }] }, b: { benefits: [{ type: 'PERCENTAGE_OFF', value: 1500 }] } },
  { name: 'maximum-discount cap binds', lines: [line('p', 500000, 1)], a: { benefits: [{ type: 'PERCENTAGE_OFF', value: 5000, maximumDiscountUgx: 20000 }] }, b: { benefits: [{ type: 'PERCENTAGE_OFF', value: 500 }] } },
  { name: 'large UGX, rounding at bps', lines: [line('p', 987654321, 1)], a: { benefits: [{ type: 'PERCENTAGE_OFF', value: 3333 }] }, b: { benefits: [{ type: 'PERCENTAGE_OFF', value: 3332 }] } },
  { name: 'fixed amount larger than the goods (clamped)', lines: [line('p', 15000, 1)], a: { benefits: [{ type: 'FIXED_AMOUNT_OFF', value: 999999 }] }, b: { benefits: [{ type: 'PERCENTAGE_OFF', value: 9999 }] } },
];

describe('exclusive-promotion ranking (estimator) agrees with application (charge) across the boundary matrix', () => {
  for (const c of cases) {
    it(c.name, () => {
      const A = rule('A', { priority: 5, ...c.a });
      const B = rule('B', { priority: 5, ...c.b });
      const sa = standalone(c.lines, A);
      const sb = standalone(c.lines, B);
      const quote = evaluatePricing(input(c.lines, [A, B]));
      const applied = quote.appliedPromotionVersions.map((v) => v.versionId);
      // Exactly one exclusive promotion applies, and it is the larger standalone benefit
      // (ties fall to deterministic ordering, never to both).
      expect(applied.length, `applied=${applied.join(',')} sa=${sa} sb=${sb}`).toBeLessThanOrEqual(1);
      if (sa !== sb) expect(applied[0], `sa=${sa} sb=${sb}`).toBe(sa > sb ? 'A-v1' : 'B-v1');
      // And the charged discount IS that standalone amount — the estimator promised what the application delivered.
      expect(quote.discountTotalUgx).toBe(Math.max(sa, sb));
      // Never below any floor, never negative.
      const goods = c.lines.reduce((s, l) => s + l.canonicalUnitPriceUgx * l.quantity, 0);
      expect(quote.discountTotalUgx).toBeGreaterThanOrEqual(0);
      expect(goods - quote.discountTotalUgx).toBeGreaterThanOrEqual(c.lines.reduce((s, l) => s + (l.floorUnitPriceUgx ?? 0) * l.quantity, 0));
    });
  }
});
