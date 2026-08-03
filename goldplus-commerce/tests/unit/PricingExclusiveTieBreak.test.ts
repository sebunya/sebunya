import { describe, expect, it } from 'vitest';
import { evaluatePricing, EvaluatePricingInput, PricingRule } from '../../apps/api/src/domain/pricing/PricingEvaluator';

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
  quoteId: 'q',
  lines: [
    { productId: 'p1', sku: 'P1', name: 'One', category: 'A', canonicalUnitPriceUgx: 1000, quantity: 2 },
    { productId: 'p2', sku: 'P2', name: 'Two', category: 'B', canonicalUnitPriceUgx: 500, quantity: 1 },
  ], // base subtotal 2500
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

describe('U1 AC2 — exclusive tie-break by larger customer benefit', () => {
  it('applies the larger-benefit exclusive and supersedes the other, even at lower priority', () => {
    // exSmall: fixed 300 off, HIGHER priority. exBig: 20% off (=500 on 2500 base), LOWER priority.
    const exSmall = rule('small', { stackable: false, priority: 50, benefits: [{ type: 'FIXED_AMOUNT_OFF', value: 300 }] });
    const exBig = rule('big', { stackable: false, priority: 10, benefits: [{ type: 'PERCENTAGE_OFF', value: 2000 }] });

    const quote = evaluatePricing(input([exSmall, exBig]));

    // Exactly one applied — the larger-benefit one (big), despite its lower priority.
    expect(quote.appliedPromotionVersions.map((p) => p.definitionId)).toEqual(['big']);
    expect(quote.discountTotalUgx).toBe(500);

    const reasons = Object.fromEntries(quote.decisionTrace.map((t) => [t.promotionDefinitionId, `${t.outcome}:${t.reason}`]));
    expect(reasons.big).toBe('APPLIED:QUALIFIED');
    expect(reasons.small).toBe('EXCLUDED:EXCLUSIVE_SUPERSEDED');
    // The superseded exclusive appears among excluded candidates with the AC2 reason.
    expect(quote.excludedCandidates).toContainEqual(
      expect.objectContaining({ promotionDefinitionId: 'small', reason: 'EXCLUSIVE_SUPERSEDED' }),
    );
  });

  it('a single exclusive is applied and never marked superseded', () => {
    const only = rule('only', { stackable: false, benefits: [{ type: 'FIXED_AMOUNT_OFF', value: 300 }] });
    const quote = evaluatePricing(input([only]));
    expect(quote.appliedPromotionVersions.map((p) => p.definitionId)).toEqual(['only']);
    expect(quote.decisionTrace.find((t) => t.promotionDefinitionId === 'only')?.reason).toBe('QUALIFIED');
    expect(quote.excludedCandidates.some((t) => t.reason === 'EXCLUSIVE_SUPERSEDED')).toBe(false);
  });

  it('three qualifying exclusives leave exactly one applied and two superseded', () => {
    const a = rule('a', { stackable: false, priority: 30, benefits: [{ type: 'FIXED_AMOUNT_OFF', value: 100 }] });
    const b = rule('b', { stackable: false, priority: 20, benefits: [{ type: 'FIXED_AMOUNT_OFF', value: 700 }] }); // largest
    const c = rule('c', { stackable: false, priority: 10, benefits: [{ type: 'FIXED_AMOUNT_OFF', value: 400 }] });
    const quote = evaluatePricing(input([a, b, c]));
    expect(quote.appliedPromotionVersions.map((p) => p.definitionId)).toEqual(['b']);
    const superseded = quote.excludedCandidates.filter((t) => t.reason === 'EXCLUSIVE_SUPERSEDED').map((t) => t.promotionDefinitionId).sort();
    expect(superseded).toEqual(['a', 'c']);
  });
});
