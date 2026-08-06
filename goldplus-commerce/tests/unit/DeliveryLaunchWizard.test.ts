import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLAUSIBLE_SPEED_MAX_KMH,
  DEFAULT_PLAUSIBLE_SPEED_MIN_KMH,
  WizardAnswers,
  deriveLaunchValues,
} from '../../apps/api/src/domain/delivery/DeliveryLaunchWizard';
import { LAUNCH_KEYS, DELIVERY_CONFIG_REGISTRY, validateConfigValue } from '../../apps/api/src/domain/delivery/DeliveryConfigRegistry';
import { validateConfigDraft } from '../../apps/api/src/domain/delivery/DeliveryConfigValidation';
import { bandMidpointKm, missingLaunchKeys, quoteDelivery, NEUTRAL_FACTOR } from '../../apps/api/src/domain/delivery/DeliveryModel';

const BOUNDS = { minKmh: DEFAULT_PLAUSIBLE_SPEED_MIN_KMH, maxKmh: DEFAULT_PLAUSIBLE_SPEED_MAX_KMH };

const answers = (over: Partial<WizardAnswers> = {}): WizardAnswers => ({
  areaSlug: 'kampala-ntinda-10101',
  areaLabel: 'Ntinda, Kampala',
  band: 'B2',
  roundTripMinutes: 45,
  riderPayUgx: 5000,
  handlingMinutes: 15,
  marginPercent: 30,
  minimumFeeUgx: 3000,
  freeDeliveryThresholdUgx: null,
  ...over,
});

describe('launch wizard — the arithmetic, with the working shown', () => {
  it('derives every launch value from one real trip', () => {
    // B2 is 5–9 km, midpoint 7, so 14 km there and back. 14 km in 45 minutes
    // is 18.666… km/h, and 5,000 UGX over 45 minutes is 111.1 a minute.
    const r = deriveLaunchValues(answers(), BOUNDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.roundTripKm).toBe(bandMidpointKm('B2') * 2);
    expect(r.values.effective_speed_kmh).toBeCloseTo(18.6667, 3);
    expect(r.values.rider_cost_per_minute_ugx).toBeCloseTo(111.111, 2);
    expect(r.values.handling_minutes).toBe(15);
    expect(r.values.margin_multiplier).toBeCloseTo(1.3, 10);
    expect(r.values.minimum_fee_ugx).toBe(3000);
  });

  it('produces exactly the five mandatory launch keys, and no sixth unless asked', () => {
    const r = deriveLaunchValues(answers(), BOUNDS);
    if (!r.ok) throw new Error('expected ok');
    expect(missingLaunchKeys(r.values)).toEqual([]);
    expect(r.values.free_delivery_threshold_ugx).toBeUndefined();

    const withFree = deriveLaunchValues(answers({ freeDeliveryThresholdUgx: 150_000 }), BOUNDS);
    if (!withFree.ok) throw new Error('expected ok');
    expect(withFree.values.free_delivery_threshold_ugx).toBe(150_000);
  });

  it('every derived value carries the answer it came from and its working', () => {
    const r = deriveLaunchValues(answers({ freeDeliveryThresholdUgx: 150_000 }), BOUNDS);
    if (!r.ok) throw new Error('expected ok');
    for (const d of r.derived) {
      expect(d.fromAnswer.length).toBeGreaterThan(0);
      expect(d.working.length).toBeGreaterThan(20);
      expect(d.key).toBeTruthy();
    }
    // The speed's working must name the place and both distances, or an
    // operator cannot check it.
    const speed = r.derived.find((d) => d.key === 'effective_speed_kmh')!;
    expect(speed.working).toContain('Ntinda, Kampala');
    expect(speed.working).toContain('14 km');
    expect(speed.working).toContain('45 minutes');
  });

  it('derived values all pass their own registry validation', () => {
    const r = deriveLaunchValues(answers({ freeDeliveryThresholdUgx: 150_000 }), BOUNDS);
    if (!r.ok) throw new Error('expected ok');
    for (const [key, value] of Object.entries(r.values)) {
      const rounded = key.endsWith('_ugx') || key === 'handling_minutes' ? String(Math.round(value)) : String(Number(value.toFixed(4)));
      const check = validateConfigValue(key, rounded);
      expect(check, `${key} = ${rounded}`).toMatchObject({ ok: true });
    }
  });

  it('the derived values actually make the module quote', () => {
    const r = deriveLaunchValues(answers(), BOUNDS);
    if (!r.ok) throw new Error('expected ok');
    const result = quoteDelivery({
      config: { ...r.values, fee_rounding_step_ugx: 500 },
      hasActiveOrigin: true,
      originCode: 'HUB-CBD-WILSON',
      area: {
        areaSlug: 'kampala-ntinda-10101',
        corridor: 'kira_rd',
        band: 'B2',
        accessMode: 'road',
        serviceable: true,
        measuredKm: null,
        centroidSource: null,
      },
      corridorFactor: NEUTRAL_FACTOR,
      hourFactor: NEUTRAL_FACTOR,
      detourFactor: NEUTRAL_FACTOR,
      lastMileMinutes: { value: 0, sampleSize: 0 },
      areaSampleSize: 0,
      observedMinutes: null,
      onTimeTargetBps: null,
      windowMinSampleSize: null,
      configVersionId: 'v1',
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    // 45 minutes travel (the trip they described) + 15 handling = 60 minutes.
    expect(result.expectedMinutes).toBeCloseTo(60, 6);
    // 60 × 111.111 × 1.3 = 8,666.6 → rounds up to 9,000.
    expect(result.feeUgx).toBe(9000);
  });
});

describe('launch wizard — every division is guarded', () => {
  it('refuses a zero trip time rather than dividing by it', () => {
    const r = deriveLaunchValues(answers({ roundTripMinutes: 0 }), BOUNDS);
    expect(r).toMatchObject({ ok: false, refusal: 'TRIP_TIME_NOT_POSITIVE' });
  });

  it('refuses a negative trip time', () => {
    expect(deriveLaunchValues(answers({ roundTripMinutes: -10 }), BOUNDS)).toMatchObject({ ok: false });
  });

  it('refuses a non-numeric trip time rather than producing NaN', () => {
    const r = deriveLaunchValues(answers({ roundTripMinutes: Number.NaN }), BOUNDS);
    expect(r).toMatchObject({ ok: false, refusal: 'TRIP_TIME_NOT_POSITIVE' });
  });

  it('refuses zero rider pay, because a free rider is not a measurement', () => {
    expect(deriveLaunchValues(answers({ riderPayUgx: 0 }), BOUNDS)).toMatchObject({
      ok: false,
      refusal: 'RIDER_PAY_INVALID',
    });
  });

  it('refuses when no area was chosen — there is no band to anchor on', () => {
    expect(deriveLaunchValues(answers({ areaSlug: '' }), BOUNDS)).toMatchObject({ ok: false, refusal: 'AREA_NOT_CHOSEN' });
  });

  it('allows zero handling and zero margin, which are real answers', () => {
    const r = deriveLaunchValues(answers({ handlingMinutes: 0, marginPercent: 0 }), BOUNDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.margin_multiplier).toBe(1);
  });

  it('never emits a non-finite value', () => {
    const r = deriveLaunchValues(answers(), BOUNDS);
    if (!r.ok) throw new Error('expected ok');
    for (const v of Object.values(r.values)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('launch wizard — plausibility warns, never refuses', () => {
  it('catches the each-way error and names the answer that caused it', () => {
    // 90 minutes for a 14 km round trip is 9.3 km/h — under the lower bound.
    const r = deriveLaunchValues(answers({ roundTripMinutes: 120 }), BOUNDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.warnings.find((x) => x.message.includes('slower'));
    expect(w).toBeTruthy();
    expect(w!.answer).toContain('How long');
    expect(w!.message).toContain('EACH WAY');
    // And it did NOT block: the values are still there.
    expect(r.values.effective_speed_kmh).toBeGreaterThan(0);
  });

  it('catches an implausibly fast trip', () => {
    const r = deriveLaunchValues(answers({ roundTripMinutes: 5 }), BOUNDS);
    if (!r.ok) throw new Error('expected ok');
    expect(r.warnings.some((w) => w.message.includes('faster'))).toBe(true);
  });

  it('states the ambiguity even when the speed is plausible', () => {
    const r = deriveLaunchValues(answers(), BOUNDS);
    if (!r.ok) throw new Error('expected ok');
    // Inventing nothing: both readings of their own answer, side by side.
    expect(r.warnings.some((w) => w.message.includes('THERE AND BACK'))).toBe(true);
  });

  it('says plainly that zero margin makes nothing', () => {
    const r = deriveLaunchValues(answers({ marginPercent: 0 }), BOUNDS);
    if (!r.ok) throw new Error('expected ok');
    expect(r.warnings.some((w) => w.message.includes('makes you nothing'))).toBe(true);
  });

  it('the bounds are configuration, so a different city moves them', () => {
    const strict = deriveLaunchValues(answers(), { minKmh: 20, maxKmh: 25 });
    if (!strict.ok) throw new Error('expected ok');
    expect(strict.warnings.some((w) => w.message.includes('slower'))).toBe(true);
  });
});

describe('launch wizard — it is an input surface, not a bypass', () => {
  it('the two plausibility bounds are declared in the registry, not hidden in code', () => {
    const keys = DELIVERY_CONFIG_REGISTRY.map((e) => e.key);
    expect(keys).toContain('plausible_speed_min_kmh');
    expect(keys).toContain('plausible_speed_max_kmh');
    // And they are Tier 1, so an operator can move them.
    for (const key of ['plausible_speed_min_kmh', 'plausible_speed_max_kmh']) {
      expect(DELIVERY_CONFIG_REGISTRY.find((e) => e.key === key)!.tier).toBe(1);
    }
  });

  it('every key the wizard writes is a registry key', () => {
    const r = deriveLaunchValues(answers({ freeDeliveryThresholdUgx: 150_000 }), BOUNDS);
    if (!r.ok) throw new Error('expected ok');
    const registryKeys = new Set(DELIVERY_CONFIG_REGISTRY.map((e) => e.key));
    for (const key of Object.keys(r.values)) expect(registryKeys.has(key)).toBe(true);
  });

  it('a wizard output passes the cross-field draft validation', () => {
    const r = deriveLaunchValues(answers({ freeDeliveryThresholdUgx: 150_000 }), BOUNDS);
    if (!r.ok) throw new Error('expected ok');
    const asStrings: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.values)) {
      asStrings[k] = k.endsWith('_ugx') || k === 'handling_minutes' ? String(Math.round(v)) : String(Number(v.toFixed(4)));
    }
    expect(validateConfigDraft(asStrings)).toEqual([]);
  });

  it('a free-delivery threshold below the minimum fee is refused as nonsense', () => {
    const problems = validateConfigDraft({ minimum_fee_ugx: '5000', free_delivery_threshold_ugx: '3000' });
    expect(problems.length).toBe(1);
    expect(problems[0].key).toBe('free_delivery_threshold_ugx');
  });

  it('a key outside the registry cannot be drafted', () => {
    const problems = validateConfigDraft({ some_invented_key: '42' });
    expect(problems[0].message).toContain('not a configurable value');
  });

  it('a Tier 3 value cannot be drafted through the config path', () => {
    // SHRINKAGE_PSEUDO_COUNT and the band edges are code-only. They are not in
    // the registry at all, so they fail as unknown keys — which is stronger
    // than being present and refused.
    expect(validateConfigDraft({ shrinkage_pseudo_count: '10' })[0].message).toContain('not a configurable value');
  });

  it('a cutoff that is not a real time of day is refused', () => {
    expect(validateConfigDraft({ same_day_cutoff_eat: '25:99' })[0].key).toBe('same_day_cutoff_eat');
    expect(validateConfigDraft({ same_day_cutoff_eat: '15:30' })).toEqual([]);
  });

  it('a zero absorption threshold is refused in favour of leaving it unset', () => {
    expect(validateConfigDraft({ variance_absorption_threshold_ugx: '0' })[0].message).toContain('unset');
  });

  it('the five mandatory launch keys are exactly what the wizard fills', () => {
    const r = deriveLaunchValues(answers(), BOUNDS);
    if (!r.ok) throw new Error('expected ok');
    expect(Object.keys(r.values).sort()).toEqual([...LAUNCH_KEYS].sort());
  });
});
