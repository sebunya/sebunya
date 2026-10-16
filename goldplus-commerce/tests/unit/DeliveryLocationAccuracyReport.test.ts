import { describe, expect, it } from 'vitest';
import {
  DeliveryLocationAccuracyReportUseCase,
  LocationAccuracyRaw,
} from '../../apps/api/src/application/use-cases/delivery/DeliveryReportUseCases';

/** 0189: the four numbers of address system spec §0, from the capture's own columns. */
const raw = (over: Partial<LocationAccuracyRaw> = {}): LocationAccuracyRaw => ({
  quotes: 220,
  own_rider_quotes: 200,
  model_priced: 150,
  median_signed_minutes: '-4.26',
  minutes_known: 40,
  median_abs_minutes: '11.26',
  first_attempt_ok: 36,
  first_attempt_known: 45,
  areas: 362,
  areas_with_point: 340,
  tiers: [
    { tier: 'AREA_POINT', n: 120 },
    { tier: 'BAND_MIDPOINT', n: 70 },
    { tier: null, n: 10 },
  ],
  sources: '[{"source":"parish_centroid","n":120},{"source":null,"n":80}]',
  ...over,
});

const run = (r: LocationAccuracyRaw) => new DeliveryLocationAccuracyReportUseCase({ locationAccuracy: async () => r }).execute();

describe('location accuracy report', () => {
  it('turns counts into percentages and reads JSON whether parsed or text', async () => {
    const out = await run(raw());
    expect(out.windowDays).toBe(28);
    expect(out.modelPricedPct).toBe(75); // of own-rider quotes, not of every capture
    expect(out.ownRiderQuotes).toBe(200);
    expect(out.medianAbsMinutes).toBe(11.3);
    expect(out.medianSignedMinutes).toBe(-4.3);
    expect(out.firstAttemptPct).toBe(80);
    expect(out.tiers.map((t) => [t.tier, t.n, t.pct])).toEqual([
      ['AREA_POINT', 120, 54.5],
      ['BAND_MIDPOINT', 70, 31.8],
      ['unrecorded', 10, 4.5],
    ]);
    expect(out.sources.map((s) => [s.source, s.n])).toEqual([
      ['parish_centroid', 120],
      ['none', 80],
    ]);
    expect(out.areasWithPoint).toBe(340);
    expect(out.note).toContain('40 with both expected and actual minutes');
  });
  it('reports absence in words, never as zero per cent', async () => {
    const empty = await run(raw({ quotes: 0, own_rider_quotes: 0, model_priced: 0, median_signed_minutes: null, minutes_known: 0, median_abs_minutes: null, first_attempt_ok: 0, first_attempt_known: 0, tiers: [], sources: [] }));
    expect(empty.modelPricedPct).toBeNull();
    expect(empty.medianAbsMinutes).toBeNull();
    expect(empty.firstAttemptPct).toBeNull();
    expect(empty.tiers).toEqual([]);
    expect(empty.note).toMatch(/nothing can be said yet/);
    const noMinutes = await run(raw({ minutes_known: 0, median_abs_minutes: null }));
    expect(noMinutes.medianAbsMinutes).toBeNull();
    expect(noMinutes.note).toMatch(/no order has both/);
  });
});
