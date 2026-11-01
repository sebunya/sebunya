import { describe, expect, it } from 'vitest';
import { detectReviewPii, computeRatingAggregate, aggregateRatingJsonLd } from '../../apps/api/src/domain/reviews/ReviewDomain';

describe('U3 review PII detection (AC5)', () => {
  it('flags emails and phone numbers', () => {
    expect(detectReviewPii('Great charger', 'contact me at bob@example.com').hasPii).toBe(true);
    expect(detectReviewPii('Call 0771234567 for a deal').kinds).toContain('phone');
    expect(detectReviewPii('reach me: +256 700 123 456').kinds).toContain('phone');
  });
  it('does not flag ordinary review text', () => {
    expect(detectReviewPii('Excellent quality', 'Lasted 5 months, worth every shilling').hasPii).toBe(false);
    expect(detectReviewPii('Rated it 5 stars out of 5').hasPii).toBe(false);
  });
});

describe('U3 rating aggregate (AC2/AC4)', () => {
  it('computes count, sum, average and distribution', () => {
    const agg = computeRatingAggregate([5, 5, 4, 1]);
    expect(agg.count).toBe(4);
    expect(agg.sum).toBe(15);
    expect(agg.average).toBe(3.75);
    expect(agg.distribution).toEqual({ '1': 1, '2': 0, '3': 0, '4': 1, '5': 2 });
  });
  it('is empty for no published reviews', () => {
    expect(computeRatingAggregate([])).toEqual({ count: 0, sum: 0, average: null, distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } });
  });
});

describe('U3 AggregateRating JSON-LD gating (AC3)', () => {
  const agg = computeRatingAggregate([5, 4]); // count 2, avg 4.5

  it('emits only when there is at least one published rating AND the product is in stock', () => {
    const jsonLd = aggregateRatingJsonLd(agg, true);
    expect(jsonLd).toEqual({ '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 2, bestRating: 5, worstRating: 1 });
  });
  it('suppresses when out of stock', () => {
    expect(aggregateRatingJsonLd(agg, false)).toBeNull();
  });
  it('suppresses when there are no reviews (never fabricates a rating)', () => {
    expect(aggregateRatingJsonLd(computeRatingAggregate([]), true)).toBeNull();
  });
});
