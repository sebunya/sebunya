import { describe, expect, it } from 'vitest';

import { RecommendationAnalyticsService } from '../../apps/api/src/application/recommendations/RecommendationAnalyticsService';

/**
 * Event-quality warnings, measured against the right population.
 *
 * The dashboard reported "High volume of events missing anonymousId". Measured
 * in production, the picture was the opposite of what that suggests:
 *
 *   127,663 api-engine serving records   — server-side, no browser identity
 *     5,796 SSR search events            — identified by visit profile
 *       566 browser impressions          — 100% anonymousId
 *        25 browser clicks               — 100% anonymousId
 *         0 events with NO identity at all
 *
 * Dividing missing-anonymousId by TOTAL events reported 4.07%, silently below
 * the 10% threshold, while the same numerator was 87.4% of its own population.
 * The measure could equally hide a real gap or invent one. These tests pin the
 * corrected semantics.
 */

/** Minimal service exercised through its warning generator. */
const svc = new RecommendationAnalyticsService({} as never) as unknown as {
  generateQualityWarnings(h: Record<string, number>): string[];
};
const warn = (h: Record<string, number>) => svc.generateQualityWarnings(h as never);

describe('identity coverage is measured against events that can carry an identity', () => {
  it('raises NO warning when every event carries some identity', () => {
    // Production truth: search events hold a profile, browser events hold an
    // anonymousId, and nothing is unattributable.
    const w = warn({
      totalEvents: 142_488, missingAnonymousId: 5_796, missingAnonymousIdEligible: 0, missingPlacement: 6_039,
      identityEligibleEvents: 837, eventsWithoutAnyIdentity: 0,
      placementEligibleEvents: 594, missingPlacementEligible: 0,
    });
    expect(w).toEqual([]);
  });

  it('warns when events are attributable to no visitor at all', () => {
    const w = warn({
      totalEvents: 1000, missingAnonymousId: 0, missingPlacement: 0,
      identityEligibleEvents: 1000, eventsWithoutAnyIdentity: 250,
      placementEligibleEvents: 0, missingPlacementEligible: 0,
    });
    expect(w.join(' ')).toMatch(/no visitor identity of any kind/i);
    expect(w.join(' ')).toContain('250');
  });

  it('does NOT treat a profile-identified event as missing identity', () => {
    // The exact false positive: SSR search events have no anonymousId by
    // design because they identify the visitor through the visit profile.
    const w = warn({
      totalEvents: 6000, missingAnonymousId: 5796, missingAnonymousIdEligible: 0, missingPlacement: 0,
      identityEligibleEvents: 200, eventsWithoutAnyIdentity: 0,
      placementEligibleEvents: 200, missingPlacementEligible: 0,
    });
    expect(w.join(' ')).not.toMatch(/missing anonymousId/i);
  });

  it('warns when client-produced events genuinely lack a browser id', () => {
    // Browser storage blocked for most visitors — a real instrumentation gap.
    const w = warn({
      totalEvents: 1000, missingAnonymousId: 400, missingAnonymousIdEligible: 400, missingPlacement: 0,
      identityEligibleEvents: 500, eventsWithoutAnyIdentity: 0,
      placementEligibleEvents: 0, missingPlacementEligible: 0,
    });
    expect(w.join(' ')).toMatch(/missing anonymousId/i);
    expect(w.join(' ')).toMatch(/80\.0%/);
  });

  it('does not warn when the client-produced gap is within tolerance', () => {
    const w = warn({
      totalEvents: 1000, missingAnonymousId: 20, missingAnonymousIdEligible: 20, missingPlacement: 0,
      identityEligibleEvents: 500, eventsWithoutAnyIdentity: 0,
      placementEligibleEvents: 0, missingPlacementEligible: 0,
    });
    expect(w.join(' ')).not.toMatch(/missing anonymousId/i);
  });

  it('never divides by an inflated total that hides the real share', () => {
    // Same numerator, same eligible population, wildly different totals.
    const small = warn({ totalEvents: 500, missingAnonymousId: 400, missingAnonymousIdEligible: 400, missingPlacement: 0,
      identityEligibleEvents: 500, eventsWithoutAnyIdentity: 0, placementEligibleEvents: 0, missingPlacementEligible: 0 });
    const huge = warn({ totalEvents: 500_000, missingAnonymousId: 400, missingAnonymousIdEligible: 400, missingPlacement: 0,
      identityEligibleEvents: 500, eventsWithoutAnyIdentity: 0, placementEligibleEvents: 0, missingPlacementEligible: 0 });
    // Server volume must not silence a client instrumentation problem.
    expect(huge).toEqual(small);
  });
});

describe('placement coverage is measured only over events that have a placement', () => {
  it('does not warn about placement on events that never carry one', () => {
    const w = warn({
      totalEvents: 142_488, missingAnonymousId: 0, missingPlacement: 6_039,
      identityEligibleEvents: 837, eventsWithoutAnyIdentity: 0,
      placementEligibleEvents: 594, missingPlacementEligible: 0,
    });
    expect(w.join(' ')).not.toMatch(/placement/i);
  });

  it('warns when recommendation events genuinely lack placement', () => {
    const w = warn({
      totalEvents: 1000, missingAnonymousId: 0, missingPlacement: 100,
      identityEligibleEvents: 0, eventsWithoutAnyIdentity: 0,
      placementEligibleEvents: 500, missingPlacementEligible: 100,
    });
    expect(w.join(' ')).toMatch(/missing placement context/i);
    expect(w.join(' ')).toMatch(/20\.0%/);
  });

  it('stays silent when placement coverage is complete', () => {
    const w = warn({
      totalEvents: 1000, missingAnonymousId: 0, missingPlacement: 0,
      identityEligibleEvents: 0, eventsWithoutAnyIdentity: 0,
      placementEligibleEvents: 594, missingPlacementEligible: 0,
    });
    expect(w).toEqual([]);
  });
});

describe('warnings degrade safely on absent inputs', () => {
  it('emits nothing when there are no events at all', () => {
    expect(warn({ totalEvents: 0, missingAnonymousId: 0, missingPlacement: 0 })).toEqual([]);
  });

  it('does not throw when the new fields are absent', () => {
    expect(() => warn({ totalEvents: 100, missingAnonymousId: 10, missingPlacement: 5 })).not.toThrow();
  });

  it('states a count and a share so the warning is actionable', () => {
    const w = warn({
      totalEvents: 1000, missingAnonymousId: 0, missingPlacement: 0,
      identityEligibleEvents: 1000, eventsWithoutAnyIdentity: 7,
      placementEligibleEvents: 0, missingPlacementEligible: 0,
    });
    expect(w[0]).toMatch(/7 event/);
    expect(w[0]).toMatch(/0\.7%/);
  });
});
