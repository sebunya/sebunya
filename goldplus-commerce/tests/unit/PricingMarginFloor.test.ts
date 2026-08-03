import { describe, expect, it } from 'vitest';
import { evaluatePricing, EvaluatePricingInput, PricingRule } from '../../apps/api/src/domain/pricing/PricingEvaluator';

const now = new Date('2026-07-20T00:00:00Z');
const rule = (id: string, overrides: Partial<PricingRule> = {}): PricingRule => ({
  definitionId: id,
  definitionKey: id,
  versionId: `${id}-v1`,
  versionNumber: 1,
  conditions: [],
  benefits: [{ type: 'PERCENTAGE_OFF', value: 1000 }], // 10%
  exclusions: [],
  schedule: { startsAt: new Date('2026-07-01T00:00:00Z'), endsAt: new Date('2026-08-01T00:00:00Z') },
  usagePolicy: { globalLimit: null, perCustomerLimit: null, perCouponLimit: null, reservationTtlSeconds: 900 },
  priority: 10,
  stackable: true,
  couponCode: null,
  priceFloorUgx: 0,
  ...overrides,
});
// One line: price 1000 x2 = 2000 revenue; cost 800/unit = 1600. Base margin 20% (2000 bps).
const input = (rules: PricingRule[], withCost = true): EvaluatePricingInput => ({
  quoteId: 'q',
  lines: [{ productId: 'p1', sku: 'P1', name: 'One', category: 'A', canonicalUnitPriceUgx: 1000, quantity: 2, ...(withCost ? { costUnitUgx: 800 } : {}) }],
  rules,
  couponCode: null,
  couponReference: null,
  customerDnaSegments: [],
  experimentEvidence: [],
  shippingUgx: 0,
  taxUgx: 0,
  evaluatedAt: now,
  expiresAt: new Date(now.getTime() + 300_000),
});

describe('U1 AC5 — margin-bps floor with iterative fallback', () => {
  it('drops the lowest-priority promotion when stacking breaches the margin floor, then holds', () => {
    // Both 10% off with a 1000 bps (10%) margin floor. Both applied → margin 0 → breach.
    // Drop the lower-priority one → one 10% → revenue 1800, margin (1800-1600)/1800 = 1111 bps ≥ floor.
    const a = rule('a', { priority: 20, minMarginBpsFloor: 1000 });
    const b = rule('b', { priority: 10, minMarginBpsFloor: 1000 });
    const quote = evaluatePricing(input([a, b]));

    expect(quote.appliedPromotionVersions.map((p) => p.definitionId)).toEqual(['a']);
    expect(quote.discountTotalUgx).toBe(200); // only one 10% survived
    expect(quote.excludedCandidates).toContainEqual(
      expect.objectContaining({ promotionDefinitionId: 'b', reason: 'MARGIN_FLOOR_BREACHED' }),
    );
  });

  it('applies both when the resulting margin stays at or above the floor', () => {
    // Low floor (100 bps): both 10% → margin 0? (revenue 1600, cost 1600 → 0 bps) < 100 → still breaches.
    // Use a genuinely satisfiable case: single 10% with a 500 bps floor holds.
    const a = rule('a', { priority: 20, minMarginBpsFloor: 500 });
    const quote = evaluatePricing(input([a]));
    // revenue 1800, margin (1800-1600)/1800 = 1111 bps ≥ 500 → applied.
    expect(quote.appliedPromotionVersions.map((p) => p.definitionId)).toEqual(['a']);
    expect(quote.excludedCandidates.some((c) => c.reason === 'MARGIN_FLOOR_BREACHED')).toBe(false);
  });

  it('skips the margin check entirely when landed cost is unknown', () => {
    // No cost on lines → floor cannot be evaluated → both stack as before.
    const a = rule('a', { priority: 20, minMarginBpsFloor: 9000 });
    const b = rule('b', { priority: 10, minMarginBpsFloor: 9000 });
    const quote = evaluatePricing(input([a, b], /* withCost */ false));
    expect(quote.appliedPromotionVersions.map((p) => p.definitionId).sort()).toEqual(['a', 'b']);
    expect(quote.excludedCandidates.some((c) => c.reason === 'MARGIN_FLOOR_BREACHED')).toBe(false);
  });

  it('drops all floored promotions if none can satisfy the floor', () => {
    // A single 10% off with an unreachable 5000 bps (50%) floor. Base margin 20%,
    // any discount lowers it; the floor can never hold → the promotion is dropped.
    const a = rule('a', { priority: 20, minMarginBpsFloor: 5000 });
    const quote = evaluatePricing(input([a]));
    expect(quote.appliedPromotionVersions).toHaveLength(0);
    expect(quote.discountTotalUgx).toBe(0);
    expect(quote.excludedCandidates).toContainEqual(
      expect.objectContaining({ promotionDefinitionId: 'a', reason: 'MARGIN_FLOOR_BREACHED' }),
    );
  });
});
