import { describe, expect, it } from 'vitest';
import { DEPTH_MIN_SAMPLE, safeShare } from '../../apps/api/src/application/recommendations/RecommendationAnalyticsService';

/**
 * §19 data purity: no percentage with an unsafe denominator — withheld with the
 * reason, never rendered as a misleadingly precise number.
 */
describe('recommendation depth metrics — safe denominators', () => {
  it('withholds the percentage below the minimum sample, with the reason', () => {
    const gated = safeShare(5, DEPTH_MIN_SAMPLE - 1);
    expect(gated.pct).toBeNull();
    expect(gated.reason).toContain('Sample too small');
    expect(gated.reason).toContain(String(DEPTH_MIN_SAMPLE));
  });

  it('computes a one-decimal share at or above the minimum sample', () => {
    expect(safeShare(15, 30)).toEqual({ pct: 50, reason: null });
    expect(safeShare(1, 30)).toEqual({ pct: 3.3, reason: null });
    expect(safeShare(0, 30)).toEqual({ pct: 0, reason: null });
  });

  it('never divides by an empty denominator', () => {
    expect(safeShare(10, 0).pct).toBeNull();
  });
});
