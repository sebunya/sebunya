import { describe, expect, it } from 'vitest';
import { ladderOrderingFlags, parseFeeLadder, placeOnLadder, rungMargins } from '../../apps/api/src/domain/delivery/DeliveryFeeLadder';
import { decideAreaPoint, geometricMedian, p90SpreadMetres } from '../../apps/api/src/domain/delivery/DeliveryAreaPoints';
import { quoteDelivery, type QuoteInputs } from '../../apps/api/src/domain/delivery/DeliveryModel';
import { ADDITIVE_NEUTRAL_FACTOR, NEUTRAL_FACTOR } from '../../apps/api/src/domain/delivery/DeliveryModel';

/** §4.5: a ladder is a quantisation of the model, not a second model. */
describe('fee ladder', () => {
  it('parses what the owner types and refuses what is not a ladder', () => {
    expect(parseFeeLadder('3000, 5000, 8000, 12000, 20000')).toEqual([3000, 5000, 8000, 12000, 20000]);
    expect(parseFeeLadder('UGX 8,000; 5000')).toBeNull(); // "8,000" splits into 8 and 000 → not whole amounts
    expect(parseFeeLadder('20000 3000')).toEqual([3000, 20000]);
    expect(parseFeeLadder('5000')).toBeNull();
    expect(parseFeeLadder('5000, 5000, 8000')).toBeNull();
    expect(parseFeeLadder('a, b')).toBeNull();
    expect(parseFeeLadder('')).toBeNull();
  });
  it('places on the lowest rung that covers the continuous fee; above the top rung is uncovered', () => {
    const l = [3000, 5000, 8000];
    expect(placeOnLadder(2999, l)).toMatchObject({ rungUgx: 3000, covered: true });
    expect(placeOnLadder(5000, l)).toMatchObject({ rungUgx: 5000, covered: true });
    expect(placeOnLadder(5001, l)).toMatchObject({ rungUgx: 8000, covered: true });
    expect(placeOnLadder(9000, l)).toMatchObject({ rungUgx: 8000, covered: false });
  });
  it('the model charges the rung but keeps the minutes, and says what the continuous fee was', () => {
    const base: QuoteInputs = {
      config: { effective_speed_kmh: 20, rider_cost_per_minute_ugx: 100, handling_minutes: 10, margin_multiplier: 1.5, minimum_fee_ugx: 2000, fee_rounding_step_ugx: 500 },
      hasActiveOrigin: true,
      originCode: 'HQ',
      area: { areaSlug: 'kampala-ntinda', corridor: 'NE', band: 'B2', measuredKm: 6, centroidSource: 'parish_centroid', centroidKm: 6, centroidExpectedErrorM: 500 } as any,
      corridorFactor: NEUTRAL_FACTOR,
      hourFactor: NEUTRAL_FACTOR,
      detourFactor: NEUTRAL_FACTOR,
      lastMileMinutes: ADDITIVE_NEUTRAL_FACTOR,
      areaSampleSize: 0,
      observedMinutes: null,
      onTimeTargetBps: null,
      windowMinSampleSize: null,
      configVersionId: null,
    };
    const continuous = quoteDelivery(base);
    const ladder = quoteDelivery({ ...base, feeShape: 'ladder', feeLadder: [3000, 5000, 8000, 12000] });
    expect(continuous.available && ladder.available).toBe(true);
    if (!continuous.available || !ladder.available) return;
    expect(ladder.expectedMinutes).toBe(continuous.expectedMinutes);
    expect(ladder.explanation.continuousFeeUgx).toBe(continuous.feeUgx);
    expect([3000, 5000, 8000, 12000]).toContain(ladder.feeUgx);
    expect(ladder.feeUgx).toBeGreaterThanOrEqual(continuous.feeUgx);
    expect(ladder.explanation.feeShape).toBe('ladder');
    // 'ladder' with no rungs is continuous, not a crash
    const noRungs = quoteDelivery({ ...base, feeShape: 'ladder', feeLadder: null });
    expect(noRungs.available && noRungs.feeUgx).toBe(continuous.feeUgx);
  });
  it('flags a nearer area on a higher rung than a farther one', () => {
    const flags = ladderOrderingFlags([
      { areaSlug: 'a', label: 'Near', oneWayKm: 3, currentFeeUgx: 5000, proposedRungUgx: 8000, covered: true },
      { areaSlug: 'b', label: 'Far', oneWayKm: 9, currentFeeUgx: 8000, proposedRungUgx: 5000, covered: true },
      { areaSlug: 'c', label: 'Farther', oneWayKm: 12, currentFeeUgx: 8000, proposedRungUgx: 12000, covered: true },
    ]);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ nearer: 'Near', farther: 'Far' });
  });
  it('the margin alarm fires on a rung whose orders ran over cost more often than the owner allows', () => {
    const captures = [
      { quotedFeeUgx: 5000, expectedMinutes: 20 }, // cost 20*100*1.5 = 3000 ok
      { quotedFeeUgx: 5000, expectedMinutes: 40 }, // 6000 over
      { quotedFeeUgx: 5000, expectedMinutes: 45 }, // 6750 over
      { quotedFeeUgx: 8000, expectedMinutes: 40 },
      { quotedFeeUgx: 9999, expectedMinutes: 40 }, // not a rung: ignored
      { quotedFeeUgx: 3000, expectedMinutes: null },
    ];
    const r = rungMargins(captures, { riderCostPerMinuteUgx: 100, marginMultiplier: 1.5 }, [3000, 5000, 8000], 10);
    expect(r.map((x) => [x.rungUgx, x.orders, x.overCost, x.alarm])).toEqual([
      [3000, 1, 0, false],
      [5000, 3, 2, true],
      [8000, 1, 0, false],
    ]);
    expect(r[1].overCostPct).toBe(66.7);
    expect(r[1].meanHeadroomUgx).toBe(Math.round((2000 - 1000 - 1750) / 3));
  });
});

/** §5.6: pins become area points only with enough of them, close enough together, and never over a hand-set point. */
describe('area points from pins', () => {
  const around = (c: { lat: number; lng: number }, n: number, spreadDeg: number) =>
    Array.from({ length: n }, (_, i) => ({ lat: c.lat + spreadDeg * Math.sin(i), lng: c.lng + spreadDeg * Math.cos(i), accuracyM: 20 }));
  const NTINDA = { lat: 0.3467, lng: 32.6181 };
  it('median and p90 behave', () => {
    const pts = around(NTINDA, 7, 0.002);
    const m = geometricMedian(pts)!;
    expect(Math.abs(m.lat - NTINDA.lat)).toBeLessThan(0.001);
    expect(p90SpreadMetres(pts, m)).toBeLessThan(400);
    expect(geometricMedian([])).toBeNull();
  });
  it('three tight handovers win; five tight customer pins otherwise; wide spreads are listed; manual is kept', () => {
    expect(decideAreaPoint({ currentSource: 'manual', handoverPins: around(NTINDA, 5, 0.001), customerPins: [] }).kind).toBe('manual_kept');
    const h = decideAreaPoint({ currentSource: 'parish_centroid', handoverPins: around(NTINDA, 3, 0.001), customerPins: [] });
    expect(h).toMatchObject({ kind: 'write', source: 'rider_handover', n: 3 });
    const inaccurate = around(NTINDA, 3, 0.001).map((p) => ({ ...p, accuracyM: 500 }));
    const c = decideAreaPoint({ currentSource: null, handoverPins: inaccurate, customerPins: around(NTINDA, 5, 0.003) });
    expect(c).toMatchObject({ kind: 'write', source: 'delivered_pins', n: 5 });
    const wide = decideAreaPoint({ currentSource: null, handoverPins: around(NTINDA, 4, 0.03), customerPins: [] });
    expect(wide.kind).toBe('wide_spread');
    expect(decideAreaPoint({ currentSource: null, handoverPins: [], customerPins: around(NTINDA, 4, 0.001) }).kind).toBe('too_few');
  });
});
