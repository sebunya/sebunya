import { describe, expect, it } from 'vitest';
import {
  scoreSignalCoOccurrences,
  asSignalScores,
  blendSignalScores,
  applyEligibilityFilters,
  scoreCompatibility,
  priceBandOf,
  priceBandFits,
  isReplenishableCategory,
  computeScoreBreakdown,
  applyDiversityStrategy,
  buildRecommendationReason,
  compareRankedCandidates,
  RankedCandidate,
} from '../../apps/api/src/domain/recommendation/RecommendationV2';
import { SignalScore } from '../../apps/api/src/domain/recommendation/RecommendationTypes';

describe('scoreSignalCoOccurrences', () => {
  it('tags the signal, filters low co-count, and emits confidence', () => {
    const scores = scoreSignalCoOccurrences('co_cart', 100, [
      { productId: 'a', coCount: 20, candidateSupport: 25 },
      { productId: 'noise', coCount: 1, candidateSupport: 3 },
    ]);
    expect(scores).toHaveLength(1);
    expect(scores[0].signal).toBe('co_cart');
    expect(scores[0].productId).toBe('a');
    expect(scores[0].confidence).toBeGreaterThan(0);
    expect(scores[0].confidence).toBeLessThanOrEqual(1);
  });

  it('still ranks niche above blockbuster (V1 normalisation preserved)', () => {
    const scores = scoreSignalCoOccurrences('co_view', 100, [
      { productId: 'niche', coCount: 20, candidateSupport: 25 },
      { productId: 'blockbuster', coCount: 30, candidateSupport: 5000 },
    ]);
    expect(scores[0].productId).toBe('niche');
  });
});

describe('blendSignalScores (surface weights)', () => {
  const coPurchase: SignalScore[] = [{ productId: 'x', signal: 'co_purchase', score: 0.5, confidence: 0.8, reasonCode: 'frequently_bought_together' }];
  const coView: SignalScore[] = [{ productId: 'x', signal: 'co_view', score: 0.9, confidence: 0.6, reasonCode: 'customers_also_viewed' }];

  it('lets the higher-weighted signal dominate the reason', () => {
    // Bought-together weights co_purchase >> co_view.
    const blended = blendSignalScores([coPurchase, coView], { co_purchase: 1, co_view: 0.2 });
    expect(blended[0].topSignal).toBe('co_purchase');
    expect(blended[0].reasonCode).toBe('frequently_bought_together');
    // Also-viewed weights co_view more -> different winner.
    const blended2 = blendSignalScores([coPurchase, coView], { co_purchase: 0.2, co_view: 1 });
    expect(blended2[0].topSignal).toBe('co_view');
  });

  it('sums contributions across signals for the same product', () => {
    const blended = blendSignalScores([coPurchase, coView], { co_purchase: 1, co_view: 1 });
    expect(blended[0].contributions.co_purchase).toBeCloseTo(0.5);
    expect(blended[0].contributions.co_view).toBeCloseTo(0.9);
    expect(blended[0].relevance).toBeCloseTo(1.4);
  });

  it('normalises popularity lists via asSignalScores', () => {
    const s = asSignalScores('bestseller', [{ productId: 'a', score: 40 }, { productId: 'b', score: 10 }]);
    expect(s[0].score).toBe(1); // max normalised
    expect(s[1].score).toBe(0.25);
  });
});

describe('applyEligibilityFilters', () => {
  const commercial = (id: string, over: Partial<{ isPublished: boolean; isDealerOnly: boolean; stock: any }> = {}) => ({
    productId: id,
    isPublished: over.isPublished ?? true,
    isDealerOnly: over.isDealerOnly ?? false,
    stockStatus: (over.stock ?? 'in_stock') as any,
  });

  it('drops anchor, seeds, purchased-non-replenishable, in-cart, unpublished, dealer-only, out-of-stock', () => {
    const candidates = ['anchor', 'seed', 'bought', 'incart', 'hidden', 'dealer', 'oos', 'good'].map((productId) => ({ productId }));
    const ctxById: Record<string, any> = {
      hidden: commercial('hidden', { isPublished: false }),
      dealer: commercial('dealer', { isDealerOnly: true }),
      oos: commercial('oos', { stock: 'out_of_stock' }),
      good: commercial('good'),
    };
    const out = applyEligibilityFilters(candidates, {
      anchorProductId: 'anchor',
      seedProductIds: new Set(['seed']),
      purchasedProductIds: new Set(['bought']),
      cartProductIds: new Set(['incart']),
      isReplenishable: () => false,
      commercialOf: (id) => ctxById[id],
    });
    expect(out.map((c) => c.productId)).toEqual(['good']);
  });

  it('keeps a purchased product when it is replenishable', () => {
    const out = applyEligibilityFilters([{ productId: 'cable' }], {
      purchasedProductIds: new Set(['cable']),
      isReplenishable: (id) => id === 'cable',
    });
    expect(out.map((c) => c.productId)).toEqual(['cable']);
  });

  it('honours merchandising exclude rules', () => {
    const out = applyEligibilityFilters([{ productId: 'a' }, { productId: 'b' }], {
      merchandising: [{ id: 'r1', action: 'exclude', productId: 'a' }],
    });
    expect(out.map((c) => c.productId)).toEqual(['b']);
  });
});

describe('compatibility scoring', () => {
  it('scores connector + wattage compatibility, and 0 without metadata', () => {
    expect(scoreCompatibility(undefined, undefined)).toBe(0);
    const charger = { productId: 'charger', connectorTypes: ['USB-C'], wattage: 30 };
    const cable = { productId: 'cable', connectorTypes: ['USB-C'], wattage: 20 };
    expect(scoreCompatibility(charger, cable)).toBeGreaterThan(0.5);
    const incompatible = { productId: 'x', connectorTypes: ['Lightning'], wattage: 100 };
    expect(scoreCompatibility(charger, incompatible)).toBeLessThan(scoreCompatibility(charger, cable));
  });
});

describe('price bands', () => {
  it('classifies by UGX thresholds', () => {
    expect(priceBandOf(30_000)).toBe('budget');
    expect(priceBandOf(90_000)).toBe('mid');
    expect(priceBandOf(300_000)).toBe('premium');
    expect(priceBandOf(null)).toBeNull();
  });

  it('applies intent-aware fit rules', () => {
    expect(priceBandFits('mid', 'premium', 'substitute')).toBe(true); // one band away
    expect(priceBandFits('budget', 'premium', 'substitute')).toBe(false); // two bands away
    expect(priceBandFits('budget', 'premium', 'upgrade')).toBe(false); // upgrade only one up
    expect(priceBandFits('budget', 'mid', 'upgrade')).toBe(true);
  });

  it('recognises replenishable categories', () => {
    expect(isReplenishableCategory('Cables')).toBe(true);
    expect(isReplenishableCategory('Power Banks')).toBe(true);
    expect(isReplenishableCategory('Personal Audio')).toBe(false);
  });
});

describe('computeScoreBreakdown', () => {
  it('penalises out-of-stock and rewards higher confidence', () => {
    const inStock = computeScoreBreakdown({ relevance: 1, confidence: 1, intent: 'complement', commercial: { productId: 'a', stockStatus: 'in_stock' } });
    const oos = computeScoreBreakdown({ relevance: 1, confidence: 1, intent: 'complement', commercial: { productId: 'a', stockStatus: 'out_of_stock' } });
    expect(inStock.finalScore).toBeGreaterThan(oos.finalScore);
    expect(inStock.availability).toBe(1);
  });

  it('applies a price-band mismatch drag', () => {
    const fit = computeScoreBreakdown({ relevance: 1, confidence: 1, intent: 'substitute', anchorBand: 'mid', commercial: { productId: 'a', priceBand: 'mid', stockStatus: 'in_stock' } });
    const mismatch = computeScoreBreakdown({ relevance: 1, confidence: 1, intent: 'substitute', anchorBand: 'budget', commercial: { productId: 'a', priceBand: 'premium', stockStatus: 'in_stock' } });
    expect(fit.finalScore).toBeGreaterThan(mismatch.finalScore);
  });
});

describe('diversity + deterministic sort', () => {
  const mk = (productId: string, finalScore: number): RankedCandidate => ({
    productId,
    reasonCode: 'fallback_popular',
    breakdown: { relevance: finalScore, confidence: 1, recency: 1, commercial: 0, availability: 1, compatibility: 0, diversityPenalty: 0, campaignBoost: 0, finalScore },
  });

  it('caps per category', () => {
    const cat: Record<string, string> = { a: 'x', b: 'x', c: 'x', d: 'y' };
    const out = applyDiversityStrategy([mk('a', 4), mk('b', 3), mk('c', 2), mk('d', 1)], { maxPerCategory: 2 }, { categoryOf: (id) => cat[id] });
    expect(out.map((r) => r.productId)).toEqual(['a', 'b', 'd']);
  });

  it('breaks ties deterministically by product id', () => {
    const a = mk('zzz', 1);
    const b = mk('aaa', 1);
    expect([a, b].sort(compareRankedCandidates).map((r) => r.productId)).toEqual(['aaa', 'zzz']);
  });
});

describe('buildRecommendationReason', () => {
  it('includes the product name for behaviour-based reasons', () => {
    const r = buildRecommendationReason('because_viewed', { productId: 'p1', productName: 'GoldPlus 20,000mAh Power Bank' });
    expect(r.code).toBe('because_viewed');
    expect(r.text).toBe('Because you viewed GoldPlus 20,000mAh Power Bank');
    expect(r.anchorProductName).toBe('GoldPlus 20,000mAh Power Bank');
  });

  it('uses generic copy for non-behaviour reasons', () => {
    expect(buildRecommendationReason('frequently_bought_together').text).toBe('Frequently bought together');
  });
});
