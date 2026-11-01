import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decode, encode, encodeIntegers, isFull, isShort, isValid, locationToIntegers, recoverNearest, shorten } from '../../packages/shared/src/locations/openLocationCode';

/** The official test vectors from github.com/google/open-location-code/test_data (Apache 2.0), copied verbatim. */
const rows = (f: string) =>
  readFileSync(new URL(`./fixtures/open-location-code/${f}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split(','));

describe('Open Location Code matches the reference implementation', () => {
  it('encodes every official vector (integer method)', () => {
    let n = 0;
    for (const [lat, lng, latInt, lngInt, len, expected] of rows('encoding.csv')) {
      expect(encodeIntegers(Number(latInt), Number(lngInt), Number(len)), `${lat},${lng}`).toBe(expected);
      n++;
    }
    expect(n).toBeGreaterThan(300);
  });

  it('converts degrees to the specified integers for every vector', () => {
    for (const [lat, lng, latInt, lngInt] of rows('encoding.csv')) {
      const [a, b] = locationToIntegers(Number(lat), Number(lng));
      // The specification allows the float conversion to differ by one unit in the last place.
      expect(Math.abs(a - Number(latInt))).toBeLessThanOrEqual(1);
      expect(Math.abs(b - Number(lngInt))).toBeLessThanOrEqual(1);
    }
  });

  it('decodes every official vector', () => {
    for (const [code, len, latLo, lngLo, latHi, lngHi] of rows('decoding.csv')) {
      const area = decode(code);
      expect(area.codeLength, code).toBe(Number(len));
      expect(area.latitudeLo).toBeCloseTo(Number(latLo), 10);
      expect(area.longitudeLo).toBeCloseTo(Number(lngLo), 10);
      expect(area.latitudeHi).toBeCloseTo(Number(latHi), 10);
      expect(area.longitudeHi).toBeCloseTo(Number(lngHi), 10);
    }
  });

  it('classifies every official validity vector', () => {
    for (const [code, valid, short, full] of rows('validityTests.csv')) {
      expect(isValid(code), code).toBe(valid === 'true');
      expect(isShort(code), code).toBe(short === 'true');
      expect(isFull(code), code).toBe(full === 'true');
    }
  });

  it('shortens and recovers every official short-code vector', () => {
    for (const [full, lat, lng, short, kind] of rows('shortCodeTests.csv')) {
      if (kind === 'S' || kind === 'B') expect(shorten(full, Number(lat), Number(lng)), `${full} S`).toBe(short);
      if (kind === 'R' || kind === 'B') expect(recoverNearest(short, Number(lat), Number(lng)), `${short} R`).toBe(full);
    }
  });

  it('a Kampala point round-trips through its local short form', () => {
    const code = encode(0.3476, 32.5825);
    expect(isFull(code)).toBe(true);
    const short = shorten(code, 0.35, 32.58);
    expect(short.length).toBeLessThan(code.length);
    expect(recoverNearest(short, 0.35, 32.58)).toBe(code);
  });
});
