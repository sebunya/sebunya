import { describe, expect, it } from 'vitest';
import {
  AreaInput,
  BAND_EDGES_KM,
  DISTANCE_BANDS,
  NEUTRAL_FACTOR,
  QuoteInputs,
  SHRINKAGE_PSEUDO_COUNT,
  REASON_COPY_KEY,
  UNAVAILABLE_REASONS,
  bandMidpointKm,
  deriveWindow,
  missingLaunchKeys,
  previewAcrossBands,
  quoteDelivery,
  roundUpTo,
  shrinkToward,
} from '../../apps/api/src/domain/delivery/DeliveryModel';
import {
  DELIVERY_CONFIG_REGISTRY,
  LAUNCH_KEYS,
  isWritableConfigKey,
  validateConfigValue,
} from '../../apps/api/src/domain/delivery/DeliveryConfigRegistry';
import { quoteFulfilment } from '../../apps/api/src/domain/delivery/DeliveryQuoteService';
import { resolveFulfilmentMode } from '../../apps/api/src/domain/delivery/DeliveryFulfilmentMode';

/**
 * RETIREMENT, 2026-08-06. The mode-dependent refusals moved OUT of the computed
 * model and into `quoteFulfilment`, which now owns "how is this destination
 * served". The computed model cannot express water, bus or unserviceable any
 * more — its input type will not carry them — so the tests for those decisions
 * live where the decisions do. `AREA_NOT_METRO` is retired outright: upcountry
 * is served, by bus, and now answers CARRIER_REQUIRED or NO_RATE_CARD.
 *
 * This helper quotes through the one service, deriving the mode the way
 * production does rather than asserting one.
 */
const viaService = (over: Partial<QuoteInputs> = {}, ownRiderMaxBand: 'B0' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | null = 'B6') => {
  const i = inputs(over);
  const mode = i.area
    ? resolveFulfilmentMode({ ...i.area, declaredMode: null }, ownRiderMaxBand)
    : null;
  return quoteFulfilment({
    area: i.area,
    mode,
    rider: i,
    bus: {
      cards: [],
      office: null,
      parcelClass: 'small',
      parcelClassRefusal: null,
      destinationTown: i.area?.district ?? null,
      destinationDistrict: i.area?.district ?? null,
      at: new Date('2026-08-06T09:00:00Z'),
      declaredValueUgx: null,
    },
    subtotalUgx: 200_000,
    proportionality: { feeToValueRatioCeiling: null, minOrderValueUgx: {}, freeDeliveryThresholdUgx: null },
  });
};

/** A complete, plausible configuration used ONLY to prove the arithmetic. */
const CONFIG = {
  effective_speed_kmh: 20,
  rider_cost_per_minute_ugx: 100,
  handling_minutes: 15,
  margin_multiplier: 1.3,
  minimum_fee_ugx: 3000,
  fee_rounding_step_ugx: 500,
};

const area = (over: Partial<AreaInput> = {}): AreaInput => ({
  areaSlug: 'kampala-ntinda-10302',
  corridor: 'kira_rd',
  band: 'B2',
  accessMode: 'road',
  serviceable: true,
  measuredKm: null,
  centroidSource: null,
  ...over,
});

const inputs = (over: Partial<QuoteInputs> = {}): QuoteInputs => ({
  config: { ...CONFIG },
  hasActiveOrigin: true,
  originCode: 'HUB-CBD-WILSON',
  area: area(),
  corridorFactor: NEUTRAL_FACTOR,
  hourFactor: NEUTRAL_FACTOR,
  detourFactor: NEUTRAL_FACTOR,
  lastMileMinutes: NEUTRAL_FACTOR,
  areaSampleSize: 0,
  observedMinutes: null,
  onTimeTargetBps: null,
  windowMinSampleSize: null,
  configVersionId: 'cfg-1',
  ...over,
});

describe('bands are arithmetic on the published edges', () => {
  it('computes each midpoint rather than carrying a hand-typed table', () => {
    expect(bandMidpointKm('B0')).toBe(1);
    expect(bandMidpointKm('B1')).toBe(3.5);
    expect(bandMidpointKm('B2')).toBe(7);
    expect(bandMidpointKm('B3')).toBe(12);
    expect(bandMidpointKm('B4')).toBe(20);
    expect(bandMidpointKm('B5')).toBe(35);
    expect(bandMidpointKm('B6')).toBe(57.5);
  });

  it('derives every midpoint from its own edges, so they cannot drift apart', () => {
    for (const band of DISTANCE_BANDS) {
      const [low, high] = BAND_EDGES_KM[band];
      expect(bandMidpointKm(band)).toBe((low + high) / 2);
    }
  });

  it('has contiguous edges with no gap or overlap', () => {
    for (let i = 1; i < DISTANCE_BANDS.length; i++) {
      expect(BAND_EDGES_KM[DISTANCE_BANDS[i]][0]).toBe(BAND_EDGES_KM[DISTANCE_BANDS[i - 1]][1]);
    }
  });
});

describe('one shrinkage formula, no special cases', () => {
  it('an unobserved value IS its prior', () => {
    expect(shrinkToward(1, null, 0)).toBe(1);
    expect(shrinkToward(1, 2.5, 0)).toBe(1);
  });

  it('a small sample is mostly prior, nudged', () => {
    const s = shrinkToward(1, 2, 3);
    expect(s).toBeGreaterThan(1);
    expect(s).toBeLessThan(1.3);
  });

  it('is exactly half prior and half evidence at the pseudo-count', () => {
    expect(shrinkToward(1, 2, SHRINKAGE_PSEUDO_COUNT)).toBeCloseTo(1.5, 10);
  });

  it('a large sample is mostly itself', () => {
    expect(shrinkToward(1, 2, 1000)).toBeGreaterThan(1.98);
  });

  it('is monotonic in the sample size', () => {
    const seq = [0, 1, 5, 20, 100, 1000].map((n) => shrinkToward(1, 2, n));
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
  });
});

describe('rounding', () => {
  it('rounds UP to the step', () => {
    expect(roundUpTo(4317, 500)).toBe(4500);
    expect(roundUpTo(4001, 500)).toBe(4500);
    expect(roundUpTo(4500, 500)).toBe(4500);
  });

  it('is applied after the margin and BEFORE the floor, so the floor wins', () => {
    // raw ≈ 100 × (15 + travel) × 1.3, deliberately tiny band to land under the floor
    const r = quoteDelivery(inputs({ area: area({ band: 'B0' }), config: { ...CONFIG, minimum_fee_ugx: 9000 } }));
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.explanation.roundedFeeUgx).toBeLessThan(9000);
    expect(r.feeUgx).toBe(9000);
    expect(r.explanation.minimumFeeApplied).toBe(true);
  });

  it('records the raw fee, the step and the rounded fee separately', () => {
    const r = quoteDelivery(inputs());
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.explanation.rawFeeUgx).toBeGreaterThan(0);
    expect(r.explanation.roundingStepUgx).toBe(500);
    expect(r.feeUgx % 500).toBe(0);
    expect(r.explanation.roundedFeeUgx!).toBeGreaterThanOrEqual(r.explanation.rawFeeUgx!);
  });
});

describe('the one equation', () => {
  it('computes the fee from the stated arithmetic, end to end', () => {
    // B2 midpoint 7km, round trip 14km, at 20km/h = 42 minutes travel.
    // + 15 handling = 57 expected minutes. × 100 UGX × 1.3 = 7,410 -> 7,500.
    const r = quoteDelivery(inputs());
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.explanation.roundTripKm).toBeCloseTo(14, 10);
    expect(r.explanation.travelMinutes).toBeCloseTo(42, 10);
    expect(r.expectedMinutes).toBeCloseTo(57, 10);
    expect(r.explanation.rawFeeUgx).toBeCloseTo(7410, 6);
    expect(r.feeUgx).toBe(7500);
  });

  it('gives the fee and the window the SAME expected minutes — they cannot disagree', () => {
    const r = quoteDelivery(
      inputs({ areaSampleSize: 50, observedMinutes: { p10: 40, p90: 80 }, onTimeTargetBps: 9000, windowMinSampleSize: 20 }),
    );
    expect(r.available).toBe(true);
    if (!r.available) return;
    // Both are produced by one call from one number.
    expect(r.expectedMinutes).toBe(r.explanation.expectedMinutes);
    expect(r.window.kind).toBe('hours');
  });

  it('a measured centroid beats the band midpoint, and the quote says which', () => {
    const midpoint = quoteDelivery(inputs());
    const measured = quoteDelivery(inputs({ area: area({ measuredKm: 3, centroidSource: 'delivered_pins' }) }));
    expect(midpoint.available && midpoint.explanation.distanceSource).toBe('band_midpoint');
    expect(measured.available && measured.explanation.distanceSource).toBe('measured_centroid');
    expect(measured.available && measured.explanation.oneWayKm).toBe(3);
    expect(measured.available && measured.explanation.centroidSource).toBe('delivered_pins');
    // 3km beats the 7km B2 midpoint, so the fee is lower.
    expect((measured as any).feeUgx).toBeLessThan((midpoint as any).feeUgx);
  });

  it('a learned factor at 1.0 with no sample changes nothing', () => {
    const neutral = quoteDelivery(inputs());
    const explicit = quoteDelivery(inputs({ corridorFactor: { value: 3, sampleSize: 0 } }));
    expect((neutral as any).feeUgx).toBe((explicit as any).feeUgx);
  });

  it('a learned factor with a real sample does move the fee', () => {
    const neutral = quoteDelivery(inputs());
    const slow = quoteDelivery(inputs({ corridorFactor: { value: 2, sampleSize: 500 } }));
    expect((slow as any).feeUgx).toBeGreaterThan((neutral as any).feeUgx);
  });
});

describe('the six refusals', () => {
  it('refuses when the address did not resolve', () => {
    const r = quoteDelivery(inputs({ area: null }));
    expect(r).toMatchObject({ available: false, reason: 'AREA_UNRESOLVED' });
  });

  it('refuses an unserviceable area at any price', () => {
    expect(viaService({ area: area({ serviceable: false }) })).toMatchObject({
      kind: 'unavailable',
      reason: 'AREA_UNSERVICEABLE',
    });
  });

  it('refuses a water area — pickup only, no road quote and no surcharge', () => {
    const r = viaService({ area: area({ accessMode: 'water' }) });
    expect(r).toMatchObject({ kind: 'unavailable', reason: 'WATER_ACCESS' });
    if (r.kind !== 'unavailable') return;
    expect(r.explanation.rawFeeUgx).toBeNull(); // nothing was computed at all
  });

  it('sends an area outside the metro corridor set to the bus path, not to a refusal', () => {
    // RETIRED: this used to assert AREA_NOT_METRO. Upcountry IS served — by bus
    // — and with no negotiated card yet the honest answer is NO_RATE_CARD.
    const r = viaService({ area: area({ corridor: null, band: null, accessMode: null }) });
    expect(r).toMatchObject({ kind: 'unavailable', reason: 'NO_RATE_CARD', mode: 'bus_parcel' });
  });

  it('distinguishes an upcountry area from an address that did not resolve', () => {
    // An Adjumani order resolved perfectly. It is served by bus, and saying so
    // is the point — it belongs in the carrier queue, not address review.
    const upcountry = viaService({
      area: area({ areaSlug: 'adjumani-esia-61004', district: 'Adjumani', corridor: null, band: null, accessMode: null }),
    });
    const unresolved = viaService({ area: null });
    expect(upcountry).toMatchObject({ kind: 'unavailable', reason: 'NO_RATE_CARD', mode: 'bus_parcel' });
    expect(unresolved).toMatchObject({ kind: 'unavailable', reason: 'AREA_UNRESOLVED' });
    expect(upcountry.kind === 'unavailable' && upcountry.explanation.areaSlug).toBe('adjumani-esia-61004');
  });

  it('never claims an upcountry area is unserviceable, which is unknown there', () => {
    // An area with no corridor row has no serviceability flag either, so
    // claiming it is unserviceable would be inventing a fact. Mode resolution
    // reaches "bus" before serviceability is ever consulted.
    const r = viaService({ area: area({ corridor: null, band: null, accessMode: null, serviceable: false }) });
    expect(r).toMatchObject({ kind: 'unavailable', mode: 'bus_parcel' });
    if (r.kind === 'unavailable') expect(r.reason).not.toBe('AREA_UNSERVICEABLE');
  });

  it('refuses when no origin is active — never a default coordinate', () => {
    const r = quoteDelivery(inputs({ hasActiveOrigin: false }));
    expect(r).toMatchObject({ available: false, reason: 'NO_ACTIVE_ORIGIN' });
  });

  it('refuses while the launch values are unset, and names which are missing', () => {
    const r = quoteDelivery(inputs({ config: {} }));
    expect(r).toMatchObject({ available: false, reason: 'CONFIG_INCOMPLETE' });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.explanation.missingConfigKeys.sort()).toEqual([...LAUNCH_KEYS].sort());
  });

  it('still refuses when only one launch value is missing', () => {
    const partial = { ...CONFIG } as Record<string, number>;
    delete partial.margin_multiplier;
    const r = quoteDelivery(inputs({ config: partial }));
    expect(r).toMatchObject({ available: false, reason: 'CONFIG_INCOMPLETE' });
    expect(r.available === false && r.explanation.missingConfigKeys).toEqual(['margin_multiplier']);
  });

  it('reports the customer-facing problem before our own', () => {
    // A water address with no config set is a WATER problem for the customer;
    // telling them our pricing is unfinished would be both wrong and useless.
    const r = viaService({ area: area({ accessMode: 'water' }), config: {}, hasActiveOrigin: false });
    expect(r).toMatchObject({ kind: 'unavailable', reason: 'WATER_ACCESS' });
  });

  it('refuses a district-only resolution as TOO COARSE, not as a failure', () => {
    // "Kampala" resolved correctly. It is simply not precise enough to price,
    // and the customer is one choice away from a fee.
    const r = viaService({ area: area({ districtOnly: true, district: 'Kampala' }) });
    expect(r).toMatchObject({ kind: 'unavailable', reason: 'AREA_TOO_COARSE' });
    expect(r.kind === 'unavailable' && r.explanation.rawFeeUgx).toBeNull();
  });

  it('can produce every reason that has a path to it', () => {
    const reasonOf = (r: ReturnType<typeof viaService>) => (r.kind === 'unavailable' ? r.reason : null);
    const produced = new Set<string | null>([
      reasonOf(viaService({ area: null })),
      reasonOf(viaService({ area: area({ districtOnly: true }) })),
      reasonOf(viaService({ area: area({ corridor: null, band: null, accessMode: null }) })),
      reasonOf(viaService({ area: area({ serviceable: false }) })),
      reasonOf(viaService({ area: area({ accessMode: 'water' }) })),
      reasonOf(viaService({ hasActiveOrigin: false })),
      reasonOf(viaService({ config: {} })),
      // The rider ceiling unset — a missing decision, named rather than assumed.
      reasonOf(viaService({}, null)),
    ]);
    produced.delete(null);
    // CARRIER_REQUIRED is produced by the surface layer when a card DOES exist
    // and the customer asked about a door delivery; the quoting service returns
    // a shipment in that case rather than an unavailable, so it is absent here
    // by design rather than by omission.
    expect([...produced].sort()).toEqual(
      [...UNAVAILABLE_REASONS].filter((r) => r !== 'CARRIER_REQUIRED').sort(),
    );
  });

  it('has a distinct copy key for every reason, and each is a real registry entry', () => {
    const keys = new Set(UNAVAILABLE_REASONS.map((r) => REASON_COPY_KEY[r]));
    expect(keys.size).toBe(UNAVAILABLE_REASONS.length);
    for (const key of keys) {
      expect(DELIVERY_CONFIG_REGISTRY.some((e) => e.key === key), key).toBe(true);
    }
  });
});

describe('the delivery window', () => {
  it('is day level while there is no on-time target to tune against', () => {
    expect(deriveWindow(inputs({ onTimeTargetBps: null }))).toEqual({
      kind: 'day',
      note: 'no_on_time_target',
    });
  });

  it('is day level while the sample is too small, even with a target', () => {
    expect(
      deriveWindow(inputs({ onTimeTargetBps: 9000, windowMinSampleSize: 30, areaSampleSize: 4, observedMinutes: { p10: 1, p90: 2 } })),
    ).toEqual({ kind: 'day', note: 'insufficient_sample' });
  });

  it('is day level when no minimum sample has been configured at all', () => {
    expect(
      deriveWindow(inputs({ onTimeTargetBps: 9000, windowMinSampleSize: null, areaSampleSize: 9999 })),
    ).toEqual({ kind: 'day', note: 'insufficient_sample' });
  });

  it('earns the hour window only when target, minimum and observations all exist', () => {
    const w = deriveWindow(
      inputs({ onTimeTargetBps: 9000, windowMinSampleSize: 20, areaSampleSize: 60, observedMinutes: { p10: 35, p90: 95 } }),
    );
    expect(w).toEqual({ kind: 'hours', lowMinutes: 35, highMinutes: 95, sampleSize: 60 });
  });

  it('never fabricates a window from the modelled minutes', () => {
    // With no observations there is nothing to take a percentile of, and the
    // brief forbids widening a made-up window to look cautious.
    const r = quoteDelivery(inputs());
    expect(r.available && r.window.kind).toBe('day');
  });
});

describe('the launch configuration', () => {
  it('has five mandatory launch numbers, a sixth that ships off, and the rider ceiling', () => {
    const mandatory = DELIVERY_CONFIG_REGISTRY.filter((e) => e.mandatory).map((e) => e.key);
    // own_rider_max_band is mandatory but is NOT a seventh launch number: it is
    // Tier 2, it is a band rather than a figure, and the wizard asks for it as
    // a place. The brief forbids a seventh number, not a seventh decision.
    expect(mandatory.sort()).toEqual([...LAUNCH_KEYS, 'own_rider_max_band'].sort());
    expect(DELIVERY_CONFIG_REGISTRY.find((e) => e.key === 'own_rider_max_band')!.tier).toBe(2);
    expect(DELIVERY_CONFIG_REGISTRY.filter((e) => e.mandatory && e.tier === 1).map((e) => e.key).sort()).toEqual(
      [...LAUNCH_KEYS].sort(),
    );
    expect(DELIVERY_CONFIG_REGISTRY.find((e) => e.key === 'free_delivery_threshold_ugx')!.mandatory).toBe(false);
  });

  it('ships every launch value UNSET — no default, no placeholder, no demo mode', () => {
    for (const key of LAUNCH_KEYS) {
      expect(DELIVERY_CONFIG_REGISTRY.find((e) => e.key === key)!.defaultValue).toBeNull();
    }
    expect(missingLaunchKeys({})).toEqual([...LAUNCH_KEYS]);
  });

  it('ships the rounding step at 500 because Rob set it, not because it looked sensible', () => {
    expect(DELIVERY_CONFIG_REGISTRY.find((e) => e.key === 'fee_rounding_step_ugx')!.defaultValue).toBe(500);
  });

  it('leaves the four reserved decisions unset', () => {
    for (const key of [
      'on_time_target_bps',
      'variance_absorption_threshold_ugx',
      'recalibration_fee_move_cap_bps',
      'window_min_sample_size',
    ]) {
      expect(DELIVERY_CONFIG_REGISTRY.find((e) => e.key === key)!.defaultValue).toBeNull();
    }
  });

  it('makes no claim about what a location pin saves', () => {
    const nudge = DELIVERY_CONFIG_REGISTRY.find((e) => e.key === 'copy_pin_nudge')!;
    expect(String(nudge.defaultValue)).not.toMatch(/\d+\s*(min|minute|hour|%)/i);
    expect(nudge.help).toMatch(/no claim|invented/i);
  });

  it('refuses a key outside the registry, which is what stops a junk drawer', () => {
    expect(isWritableConfigKey('effective_speed_kmh')).toBe(true);
    expect(isWritableConfigKey('something_someone_invented')).toBe(false);
    expect(validateConfigValue('something_someone_invented', '5')).toMatchObject({ ok: false });
  });

  it('validates type and range at the point of entry', () => {
    expect(validateConfigValue('effective_speed_kmh', '20')).toMatchObject({ ok: true, value: 20 });
    expect(validateConfigValue('effective_speed_kmh', 'fast')).toMatchObject({ ok: false });
    expect(validateConfigValue('effective_speed_kmh', '0')).toMatchObject({ ok: false });
    expect(validateConfigValue('minimum_fee_ugx', '3000.5')).toMatchObject({ ok: false });
    expect(validateConfigValue('margin_multiplier', '0.5')).toMatchObject({ ok: false });
  });
});

describe('the band preview that catches a mistyped speed', () => {
  // Every sample is marked own_rider so the preview exercises the computed
  // model across all seven bands. In production the mode is derived, and a band
  // beyond the rider ceiling shows CARRIER_REQUIRED here instead — which is the
  // change an operator is approving when they move the ceiling.
  const samples = DISTANCE_BANDS.map((band) => ({
    band,
    areaSlug: `area-${band}`,
    areaLabel: `Sample ${band}`,
    area: area({ band, areaSlug: `area-${band}`, fulfilmentMode: 'own_rider' as const }),
  }));

  it('quotes one area in every band', () => {
    const rows = previewAcrossBands(samples, inputs());
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.feeUgx !== null)).toBe(true);
    // Fees increase with distance, which is what makes a wrong speed obvious.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].feeUgx!).toBeGreaterThanOrEqual(rows[i - 1].feeUgx!);
    }
  });

  it('makes a speed typo glaring — 5 km/h instead of 20 quadruples every fee', () => {
    const right = previewAcrossBands(samples, inputs());
    const typo = previewAcrossBands(samples, inputs({ config: { ...CONFIG, effective_speed_kmh: 5 } }));
    const far = DISTANCE_BANDS.indexOf('B6');
    // Travel time quadruples; handling is unchanged, so the fee rises sharply.
    expect(typo[far].feeUgx!).toBeGreaterThan(right[far].feeUgx! * 3);
  });

  it('shows the refusal reason rather than a blank when a band cannot quote', () => {
    const rows = previewAcrossBands(samples, inputs({ config: {} }));
    expect(rows.every((r) => r.unavailableReason === 'CONFIG_INCOMPLETE')).toBe(true);
    expect(rows.every((r) => r.feeUgx === null)).toBe(true);
  });

  it('shows a band beyond the rider ceiling as carrier-served, not as a gap', () => {
    // The operator needs to SEE which bands go by bus. A blank row would read
    // as a broken preview; CARRIER_REQUIRED reads as the decision it is.
    const busSamples = samples.map((s) => ({
      ...s,
      area: area({ band: s.band, areaSlug: s.areaSlug, fulfilmentMode: 'bus_parcel' as const }),
    }));
    const rows = previewAcrossBands(busSamples, inputs());
    expect(rows.every((r) => r.unavailableReason === 'CARRIER_REQUIRED')).toBe(true);
    expect(rows.every((r) => r.feeUgx === null)).toBe(true);
  });
});

describe('the explanation record', () => {
  it('carries everything needed to answer “why is this the fee”', () => {
    const r = quoteDelivery(inputs({ area: area({ measuredKm: 6.2, centroidSource: 'delivered_pins' }) }));
    expect(r.available).toBe(true);
    if (!r.available) return;
    const e = r.explanation;
    expect(e.originCode).toBe('HUB-CBD-WILSON');
    expect(e.areaSlug).toBe('kampala-ntinda-10302');
    expect(e.corridor).toBe('kira_rd');
    expect(e.band).toBe('B2');
    expect(e.distanceSource).toBe('measured_centroid');
    expect(e.centroidSource).toBe('delivered_pins');
    expect(e.configVersionId).toBe('cfg-1');
    expect(e.roundingStepUgx).toBe(500);
    expect(e.factors.corridor).toEqual(NEUTRAL_FACTOR);
    expect(e.factors.hour.sampleSize).toBe(0);
    expect(e.unavailableReason).toBeNull();
  });

  it('carries the reason and the sample sizes even when there is no quote', () => {
    const r = quoteDelivery(inputs({ area: null }));
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.explanation.unavailableReason).toBe('AREA_UNRESOLVED');
    expect(r.explanation.originCode).toBe('HUB-CBD-WILSON');
    expect(r.explanation.factors.corridor.sampleSize).toBe(0);
  });
});
