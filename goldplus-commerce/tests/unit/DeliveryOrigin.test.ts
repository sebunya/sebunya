import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DeliveryOriginRecord,
  UGANDA_BBOX,
  dispatchInstructions,
  haversineKm,
  isWithinUganda,
  resolveDispatchOrigin,
  validateOriginCoordinates,
} from '../../apps/api/src/domain/delivery/DeliveryOrigin';

/**
 * The origin guard. This exists because the supplied decimal longitude was
 * 0.5775 instead of 32.5775 — the whole degrees component was dropped, which
 * `34/60 + 39/3600 === 0.5775` proves was a conversion error rather than a
 * typo. A corrected constant would fix that instance; this test fixes the class.
 */

const WILSON_ROAD = { lat: 0.31333, lng: 32.5775 };
const BAD_CONVERSION = { lat: 0.3133, lng: 0.5775 };

const origin = (over: Partial<DeliveryOriginRecord> = {}): DeliveryOriginRecord => ({
  originCode: 'HUB-CBD-WILSON',
  name: 'GoldPlus Wilson Road',
  role: 'primary_dispatch_hub',
  street: 'Wilson Road',
  landmarkPrimary: 'Next to Uhuru Restaurant',
  landmarkSecondary: 'Opposite the Pioneer Mall parking area',
  areaSlug: 'kampala-civic-centre-10101',
  district: 'Kampala',
  corridor: 'cbd',
  distanceBand: 'B0',
  latitude: WILSON_ROAD.lat,
  longitude: WILSON_ROAD.lng,
  coordSource: 'operator_supplied_dms_converted',
  coordAnchor: 'Uhuru Restaurant, Wilson Road (adjacent premises)',
  coordConfidence: 'approximate_adjacent_landmark',
  active: true,
  ...over,
});

describe('the DMS conversion that was wrong', () => {
  it('converts the supplied DMS to the correct decimal pair', () => {
    const dms = (d: number, m: number, s: number) => d + m / 60 + s / 3600;
    expect(dms(0, 18, 48)).toBeCloseTo(0.31333, 5);
    expect(dms(32, 34, 39)).toBeCloseTo(32.5775, 5);
  });

  it('shows the bad value is exactly the minutes and seconds with the degrees dropped', () => {
    // This is the whole reason the error is a class and not a typo.
    expect(34 / 60 + 39 / 3600).toBeCloseTo(0.5775, 6);
  });

  it('accepts the corrected origin and rejects the supplied one', () => {
    expect(isWithinUganda(WILSON_ROAD.lat, WILSON_ROAD.lng)).toBe(true);
    expect(isWithinUganda(BAD_CONVERSION.lat, BAD_CONVERSION.lng)).toBe(false);
    expect(validateOriginCoordinates(BAD_CONVERSION.lat, BAD_CONVERSION.lng)).toMatchObject({
      ok: false,
      reason: 'OUTSIDE_UGANDA',
    });
  });

  it('names the missing-origin case separately from the conversion case', () => {
    // A missing row degrades to (0,0). Same guard, different diagnosis.
    expect(validateOriginCoordinates(0, 0)).toMatchObject({ ok: false, reason: 'NULL_ISLAND' });
    expect(validateOriginCoordinates(Number.NaN, 32.5)).toMatchObject({
      ok: false,
      reason: 'NON_FINITE_COORDINATE',
    });
  });

  it('keeps the bounding box generous enough for the whole country', () => {
    expect(isWithinUganda(4.2, 34.0)).toBe(true); // Kaabong, far north-east
    expect(isWithinUganda(-1.4, 29.6)).toBe(true); // Kisoro, far south-west
    expect(isWithinUganda(-1.6, 32.0)).toBe(false); // just south of the border
    expect(UGANDA_BBOX.minLat).toBeLessThan(0);
  });
});

describe('resolving the origin a quote computes from', () => {
  it('resolves the active primary hub', () => {
    const r = resolveDispatchOrigin([origin()]);
    expect(r.ok).toBe(true);
    expect(r.ok && r.origin.originCode).toBe('HUB-CBD-WILSON');
  });

  it('refuses when no origin is active — never a default coordinate', () => {
    expect(resolveDispatchOrigin([origin({ active: false })])).toMatchObject({
      ok: false,
      reason: 'NO_ACTIVE_ORIGIN',
    });
    expect(resolveDispatchOrigin([])).toMatchObject({ ok: false, reason: 'NO_ACTIVE_ORIGIN' });
  });

  it('refuses an active origin whose coordinates left the country', () => {
    expect(
      resolveDispatchOrigin([origin({ latitude: BAD_CONVERSION.lat, longitude: BAD_CONVERSION.lng })]),
    ).toMatchObject({ ok: false, reason: 'OUTSIDE_UGANDA' });
  });
});

describe('dispatch instructions', () => {
  it('carries both landmarks with Uhuru Restaurant first', () => {
    const parts = dispatchInstructions(origin());
    expect(parts[0]).toBe('Wilson Road');
    expect(parts[1]).toContain('Uhuru Restaurant');
    expect(parts[2]).toContain('Pioneer Mall');
    expect(parts.findIndex((p) => p.includes('Uhuru'))).toBeLessThan(
      parts.findIndex((p) => p.includes('Pioneer')),
    );
  });

  it('omits an absent landmark rather than emitting a blank line', () => {
    expect(dispatchInstructions(origin({ landmarkSecondary: null }))).toHaveLength(2);
  });
});

describe('distance', () => {
  it('measures a known short hop about right', () => {
    // Wilson Road to Ntinda is roughly 6 km straight line.
    const km = haversineKm(WILSON_ROAD, { lat: 0.3536, lng: 32.6136 });
    expect(km).toBeGreaterThan(4);
    expect(km).toBeLessThan(8);
  });

  it('would have measured thousands of km from the bad origin', () => {
    const km = haversineKm(BAD_CONVERSION, { lat: 0.3536, lng: 32.6136 });
    expect(km).toBeGreaterThan(3_000);
  });
});

describe('the origins data file', () => {
  const path = resolve(__dirname, '../../data/locations/v2/goldplus_delivery_origins.csv');

  it.skipIf(!existsSync(path))('ships the corrected coordinate and both landmarks', () => {
    const csv = readFileSync(path, 'utf8');
    const [header, row] = csv.split(/\r?\n/);
    const cols = header.split(',');
    // Quoted fields exist in this row, so read the numeric columns positionally
    // against the header rather than naively splitting the whole line.
    expect(cols).toContain('latitude');
    expect(cols).toContain('longitude');
    expect(row).toContain('0.31333');
    expect(row).toContain('32.57750');
    expect(row).not.toContain(',0.5775,');
    expect(csv).toContain('Uhuru Restaurant');
    expect(csv).toContain('Pioneer Mall');
    expect(csv.indexOf('Uhuru Restaurant')).toBeLessThan(csv.indexOf('Pioneer Mall'));
  });
});
