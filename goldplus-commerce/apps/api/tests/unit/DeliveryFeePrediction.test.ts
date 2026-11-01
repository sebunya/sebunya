import { describe, it, expect } from 'vitest';
import {
  UGANDA_DISTRICTS,
  UGANDA_DISTRICT_ROAD_KM,
  UGANDA_METRO_AREA_KM,
  deliveryPointKm,
  geoCoverageGaps,
} from '@goldplus/shared';
import {
  bandForKm,
  estimateDeliveryFee,
  medianUgx,
  validateBandPolicy,
  DEFAULT_DELIVERY_BAND_POLICY,
  MIN_OBSERVATIONS,
} from '../../src/domain/commerce/DeliveryFeePrediction';

describe('Uganda geography table', () => {
  it('covers every canonical district — a district without geography cannot be priced', () => {
    const missing = UGANDA_DISTRICTS.filter((d) => UGANDA_DISTRICT_ROAD_KM[d] === undefined);
    expect(missing).toEqual([]);
  });

  it('has no orphan geography — every km entry belongs to a canonical district', () => {
    const canonical = new Set(UGANDA_DISTRICTS);
    const orphans = Object.keys(UGANDA_DISTRICT_ROAD_KM).filter((d) => !canonical.has(d));
    expect(orphans).toEqual([]);
  });

  it('orders well-known distances sanely (rounded facts, not fake precision)', () => {
    const km = UGANDA_DISTRICT_ROAD_KM;
    expect(km['Kampala']).toBe(0);
    expect(km['Wakiso']).toBeLessThan(km['Jinja']);
    expect(km['Jinja']).toBeLessThan(km['Mbale']);
    expect(km['Mbale']).toBeLessThan(km['Soroti']);
    expect(km['Mbarara']).toBeLessThan(km['Kabale']);
    expect(km['Kabale']).toBeLessThan(km['Kisoro']);
    expect(km['Gulu']).toBeLessThan(km['Arua']);
    expect(km['Kaabong']).toBeGreaterThan(500);
  });

  it('gives metro areas their own distance so Wakiso is not priced as one place', () => {
    expect(deliveryPointKm('Wakiso', 'Nansana')).toBe(12);
    expect(deliveryPointKm('Wakiso', 'Entebbe')).toBe(40);
    expect(deliveryPointKm('Wakiso', null)).toBe(15);
    // Upcountry alias falls back to its district distance.
    expect(deliveryPointKm('Buikwe', 'Lugazi')).toBe(UGANDA_DISTRICT_ROAD_KM['Buikwe']);
  });

  it('leaves no curated alias without a priceable distance', () => {
    expect(geoCoverageGaps()).toEqual([]);
  });

  it('keeps every metro-area distance inside the metro bands', () => {
    for (const [area, km] of Object.entries(UGANDA_METRO_AREA_KM)) {
      expect(km, area).toBeLessThanOrEqual(45);
    }
  });
});

describe('band model', () => {
  it('assigns the rings Kampala commerce actually uses', () => {
    expect(bandForKm(3)).toBe('CORE');
    expect(bandForKm(8)).toBe('CITY');
    expect(bandForKm(14)).toBe('METRO');
    expect(bandForKm(40)).toBe('METRO_EDGE');
    expect(bandForKm(80)).toBe('NEAR');
    expect(bandForKm(270)).toBe('MID');
    expect(bandForKm(500)).toBe('FAR');
    expect(bandForKm(600)).toBe('REMOTE');
  });
});

describe('estimateDeliveryFee precedence', () => {
  const policy = DEFAULT_DELIVERY_BAND_POLICY;

  it('a configured zone is CONFIRMED and beats everything', () => {
    const r = estimateDeliveryFee({ policy, km: 14, zoneFeeUgx: 9_000, observation: { medianFeeUgx: 20_000, sampleSize: 5 } });
    expect(r.kind).toBe('CONFIRMED');
    expect(r.source).toBe('ZONE');
    expect(r.feeUgx).toBe(9_000);
  });

  it('enough confirmed order fees beat the model — the business already answered', () => {
    const r = estimateDeliveryFee({ policy, km: 270, zoneFeeUgx: null, observation: { medianFeeUgx: 18_000, sampleSize: MIN_OBSERVATIONS } });
    expect(r.kind).toBe('ESTIMATED');
    expect(r.source).toBe('OBSERVED');
    expect(r.feeUgx).toBe(18_000);
  });

  it('too few observations fall back to the model band', () => {
    const r = estimateDeliveryFee({ policy, km: 270, zoneFeeUgx: null, observation: { medianFeeUgx: 99_000, sampleSize: MIN_OBSERVATIONS - 1 } });
    expect(r.source).toBe('MODEL');
    expect(r.feeUgx).toBe(policy.midFeeUgx);
  });

  it('flags drift when reality disagrees with the model', () => {
    const r = estimateDeliveryFee({ policy, km: 270, zoneFeeUgx: null, observation: { medianFeeUgx: 30_000, sampleSize: 3 } });
    expect(r.observedDisagreesWithModel).toBe(true);
  });

  it('a disabled policy shows customers nothing rather than an unowned number', () => {
    const r = estimateDeliveryFee({ policy: { ...policy, enabled: false }, km: 14, zoneFeeUgx: null, observation: null });
    expect(r.kind).toBe('UNAVAILABLE');
    expect(r.feeUgx).toBeNull();
  });

  it('unknown geography is UNAVAILABLE, never a guess', () => {
    const r = estimateDeliveryFee({ policy, km: null, zoneFeeUgx: null, observation: null });
    expect(r.kind).toBe('UNAVAILABLE');
  });
});

describe('helpers', () => {
  it('median ignores junk and handles even counts', () => {
    expect(medianUgx([])).toBeNull();
    expect(medianUgx([0, -5, NaN])).toBeNull();
    expect(medianUgx([10_000])).toBe(10_000);
    expect(medianUgx([10_000, 20_000])).toBe(15_000);
    expect(medianUgx([5_000, 10_000, 50_000])).toBe(10_000);
  });

  it('rejects non-integer or absurd policies', () => {
    expect(validateBandPolicy({ ...DEFAULT_DELIVERY_BAND_POLICY })).toBeNull();
    expect(validateBandPolicy({ ...DEFAULT_DELIVERY_BAND_POLICY, coreFeeUgx: 2.5 })).toContain('coreFeeUgx');
    expect(validateBandPolicy({ ...DEFAULT_DELIVERY_BAND_POLICY, farFeeUgx: 99_999_999 })).toContain('farFeeUgx');
    expect(validateBandPolicy({ ...DEFAULT_DELIVERY_BAND_POLICY, enabled: undefined as unknown as boolean })).toContain('enabled');
  });
});
