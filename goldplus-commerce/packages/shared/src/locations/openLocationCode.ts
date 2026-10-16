/**
 * Open Location Code ("Plus Codes"), ported from the reference implementation at
 * https://github.com/google/open-location-code (Apache License 2.0, © Google LLC), specification v1.1 integer
 * method. Pure and offline: no Google API, no key, no request. Verified against the project's own test vectors
 * (encoding, decoding, short codes, validity) in tests/unit/OpenLocationCode.test.ts.
 *
 * A 10-digit code is a cell of about 14 m × 14 m; 11 digits about 3.5 m × 2.8 m. A short code ("7Q4P+5X") is
 * recovered from a nearby reference point (e.g. the centre of an area), which is how a code is said aloud:
 * "7Q4P+5X Kira". Google Maps opens any valid code.
 *
 * GoldPlus rule (Google Maps Platform Terms §3.2.3(c)): codes are made only from points the CUSTOMER or our RIDERS
 * gave us (device GPS, a shared WhatsApp location, a rider's handover point) — never from Google Places content.
 */

const SEPARATOR = '+';
const SEPARATOR_POSITION = 8;
const PADDING = '0';
const ALPHABET = '23456789CFGHJMPQRVWX';
const BASE = ALPHABET.length; // 20
const LATITUDE_MAX = 90;
const LONGITUDE_MAX = 180;
const MIN_DIGIT_COUNT = 2;
const MAX_DIGIT_COUNT = 15;
const PAIR_CODE_LENGTH = 10;
const PAIR_FIRST_PLACE_VALUE = BASE ** (PAIR_CODE_LENGTH / 2 - 1); // 160000
const PAIR_PRECISION = BASE ** 3; // 8000
const PAIR_RESOLUTIONS = [20.0, 1.0, 0.05, 0.0025, 0.000125];
const GRID_CODE_LENGTH = MAX_DIGIT_COUNT - PAIR_CODE_LENGTH; // 5
const GRID_COLUMNS = 4;
const GRID_ROWS = 5;
const GRID_LAT_FIRST_PLACE_VALUE = GRID_ROWS ** (GRID_CODE_LENGTH - 1); // 625
const GRID_LNG_FIRST_PLACE_VALUE = GRID_COLUMNS ** (GRID_CODE_LENGTH - 1); // 256
const FINAL_LAT_PRECISION = PAIR_PRECISION * GRID_ROWS ** GRID_CODE_LENGTH; // 25,000,000
const FINAL_LNG_PRECISION = PAIR_PRECISION * GRID_COLUMNS ** GRID_CODE_LENGTH; // 8,192,000
const MIN_TRIMMABLE_CODE_LEN = 6;

export interface CodeArea {
  latitudeLo: number;
  longitudeLo: number;
  latitudeHi: number;
  longitudeHi: number;
  codeLength: number;
  latitudeCenter: number;
  longitudeCenter: number;
}

function codeArea(latLo: number, lngLo: number, latHi: number, lngHi: number, codeLength: number): CodeArea {
  return {
    latitudeLo: latLo,
    longitudeLo: lngLo,
    latitudeHi: latHi,
    longitudeHi: lngHi,
    codeLength,
    latitudeCenter: Math.min(latLo + (latHi - latLo) / 2, LATITUDE_MAX),
    longitudeCenter: Math.min(lngLo + (lngHi - lngLo) / 2, LONGITUDE_MAX),
  };
}

export function isValid(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  const sep = code.indexOf(SEPARATOR);
  if (sep === -1) return false;
  if (sep !== code.lastIndexOf(SEPARATOR)) return false;
  if (code.length === 1) return false;
  if (sep > SEPARATOR_POSITION || sep % 2 === 1) return false;
  if (code.indexOf(PADDING) > -1) {
    if (sep < SEPARATOR_POSITION) return false;
    if (code.indexOf(PADDING) === 0) return false;
    const pad = code.match(/(0+)/g);
    if (!pad || pad.length > 1 || pad[0].length % 2 === 1 || pad[0].length > SEPARATOR_POSITION - 2) return false;
    if (code.charAt(code.length - 1) !== SEPARATOR) return false;
  }
  if (code.length - sep - 1 === 1) return false;
  const stripped = code.replace(/\+/g, '').replace(/0+/, '');
  for (const ch of stripped) if (ALPHABET.indexOf(ch.toUpperCase()) === -1) return false;
  return true;
}

export function isShort(code: string): boolean {
  if (!isValid(code)) return false;
  const sep = code.indexOf(SEPARATOR);
  return sep >= 0 && sep < SEPARATOR_POSITION;
}

export function isFull(code: string): boolean {
  if (!isValid(code)) return false;
  if (isShort(code)) return false;
  const firstLat = ALPHABET.indexOf(code.charAt(0).toUpperCase()) * BASE;
  if (firstLat >= LATITUDE_MAX * 2) return false;
  if (code.length > 1) {
    const firstLng = ALPHABET.indexOf(code.charAt(1).toUpperCase()) * BASE;
    if (firstLng >= LONGITUDE_MAX * 2) return false;
  }
  return true;
}

/** Latitude/longitude → the integers the specification encodes, so encoding is exact (no float drift). */
export function locationToIntegers(latitude: number, longitude: number): [number, number] {
  let latVal = Math.floor(latitude * FINAL_LAT_PRECISION);
  latVal += LATITUDE_MAX * FINAL_LAT_PRECISION;
  if (latVal < 0) latVal = 0;
  else if (latVal >= 2 * LATITUDE_MAX * FINAL_LAT_PRECISION) latVal = 2 * LATITUDE_MAX * FINAL_LAT_PRECISION - 1;
  let lngVal = Math.floor(longitude * FINAL_LNG_PRECISION);
  lngVal += LONGITUDE_MAX * FINAL_LNG_PRECISION;
  const span = 2 * LONGITUDE_MAX * FINAL_LNG_PRECISION;
  if (lngVal < 0) lngVal = (lngVal % span) + span;
  else if (lngVal >= span) lngVal = lngVal % span;
  return [latVal, lngVal];
}

export function encodeIntegers(latInt: number, lngInt: number, codeLength = PAIR_CODE_LENGTH): string {
  if (codeLength < MIN_DIGIT_COUNT || (codeLength < PAIR_CODE_LENGTH && codeLength % 2 === 1)) {
    throw new Error(`Invalid Open Location Code length: ${codeLength}`);
  }
  const length = Math.min(codeLength, MAX_DIGIT_COUNT);
  let latVal = latInt;
  let lngVal = lngInt;
  let code = '';
  if (length > PAIR_CODE_LENGTH) {
    for (let i = 0; i < GRID_CODE_LENGTH; i++) {
      const latDigit = latVal % GRID_ROWS;
      const lngDigit = lngVal % GRID_COLUMNS;
      code = ALPHABET.charAt(latDigit * GRID_COLUMNS + lngDigit) + code;
      latVal = Math.floor(latVal / GRID_ROWS);
      lngVal = Math.floor(lngVal / GRID_COLUMNS);
    }
  } else {
    latVal = Math.floor(latVal / GRID_ROWS ** GRID_CODE_LENGTH);
    lngVal = Math.floor(lngVal / GRID_COLUMNS ** GRID_CODE_LENGTH);
  }
  for (let i = 0; i < PAIR_CODE_LENGTH / 2; i++) {
    code = ALPHABET.charAt(lngVal % BASE) + code;
    code = ALPHABET.charAt(latVal % BASE) + code;
    latVal = Math.floor(latVal / BASE);
    lngVal = Math.floor(lngVal / BASE);
  }
  code = code.substring(0, SEPARATOR_POSITION) + SEPARATOR + code.substring(SEPARATOR_POSITION);
  if (length >= SEPARATOR_POSITION) return code.substring(0, length + 1);
  return code.substring(0, length) + PADDING.repeat(SEPARATOR_POSITION - length) + SEPARATOR;
}

export function encode(latitude: number, longitude: number, codeLength = PAIR_CODE_LENGTH): string {
  const [latInt, lngInt] = locationToIntegers(latitude, longitude);
  return encodeIntegers(latInt, lngInt, codeLength);
}

export function decode(code: string): CodeArea {
  if (!isFull(code)) throw new Error(`Not a full Open Location Code: ${code}`);
  const clean = code.replace(SEPARATOR, '').replace(/0+/, '').toUpperCase();
  let normalLat = -LATITUDE_MAX * PAIR_PRECISION;
  let normalLng = -LONGITUDE_MAX * PAIR_PRECISION;
  let gridLat = 0;
  let gridLng = 0;
  let digits = Math.min(clean.length, PAIR_CODE_LENGTH);
  let pv = PAIR_FIRST_PLACE_VALUE;
  for (let i = 0; i < digits; i += 2) {
    normalLat += ALPHABET.indexOf(clean.charAt(i)) * pv;
    normalLng += ALPHABET.indexOf(clean.charAt(i + 1)) * pv;
    if (i < digits - 2) pv /= BASE;
  }
  let latPrecision = pv / PAIR_PRECISION;
  let lngPrecision = pv / PAIR_PRECISION;
  if (clean.length > PAIR_CODE_LENGTH) {
    let rowpv = GRID_LAT_FIRST_PLACE_VALUE;
    let colpv = GRID_LNG_FIRST_PLACE_VALUE;
    digits = Math.min(clean.length, MAX_DIGIT_COUNT);
    for (let i = PAIR_CODE_LENGTH; i < digits; i++) {
      const digitVal = ALPHABET.indexOf(clean.charAt(i));
      const row = Math.floor(digitVal / GRID_COLUMNS);
      const col = digitVal % GRID_COLUMNS;
      gridLat += row * rowpv;
      gridLng += col * colpv;
      if (i < digits - 1) {
        rowpv /= GRID_ROWS;
        colpv /= GRID_COLUMNS;
      }
    }
    latPrecision = rowpv / FINAL_LAT_PRECISION;
    lngPrecision = colpv / FINAL_LNG_PRECISION;
  }
  const lat = normalLat / PAIR_PRECISION + gridLat / FINAL_LAT_PRECISION;
  const lng = normalLng / PAIR_PRECISION + gridLng / FINAL_LNG_PRECISION;
  return codeArea(lat, lng, lat + latPrecision, lng + lngPrecision, Math.min(clean.length, MAX_DIGIT_COUNT));
}

function clipLatitude(latitude: number): number {
  return Math.min(90, Math.max(-90, latitude));
}

function normalizeLongitude(longitude: number): number {
  let lng = longitude;
  while (lng < -180) lng += 360;
  while (lng >= 180) lng -= 360;
  return lng;
}

/** Drops leading digits a nearby reference point makes recoverable: "6GGJ7Q4P+5X" near Kira → "7Q4P+5X". */
export function shorten(code: string, latitude: number, longitude: number): string {
  if (!isFull(code)) throw new Error(`Not a full code: ${code}`);
  if (code.indexOf(PADDING) !== -1) throw new Error(`Cannot shorten a padded code: ${code}`);
  const upper = code.toUpperCase();
  const area = decode(upper);
  if (area.codeLength < MIN_TRIMMABLE_CODE_LEN) throw new Error(`Code too short to shorten: ${code}`);
  const lat = clipLatitude(latitude);
  const lng = normalizeLongitude(longitude);
  const range = Math.max(Math.abs(area.latitudeCenter - lat), Math.abs(area.longitudeCenter - lng));
  for (let i = PAIR_RESOLUTIONS.length - 2; i >= 1; i--) {
    if (range < PAIR_RESOLUTIONS[i] * 0.3) return upper.substring((i + 1) * 2);
  }
  return upper;
}

/** A short code + a nearby reference point → the full code nearest to that point. */
export function recoverNearest(shortCode: string, referenceLatitude: number, referenceLongitude: number): string {
  if (!isShort(shortCode)) {
    if (isFull(shortCode)) return shortCode.toUpperCase();
    throw new Error(`Not a valid short code: ${shortCode}`);
  }
  const refLat = clipLatitude(referenceLatitude);
  const refLng = normalizeLongitude(referenceLongitude);
  const upper = shortCode.toUpperCase();
  const paddingLength = SEPARATOR_POSITION - upper.indexOf(SEPARATOR);
  const resolution = 20 ** (2 - paddingLength / 2);
  const half = resolution / 2;
  const area = decode(encode(refLat, refLng).substring(0, paddingLength) + upper);
  let latCenter = area.latitudeCenter;
  let lngCenter = area.longitudeCenter;
  if (refLat + half < latCenter && latCenter - resolution >= -LATITUDE_MAX) latCenter -= resolution;
  else if (refLat - half > latCenter && latCenter + resolution <= LATITUDE_MAX) latCenter += resolution;
  if (refLng + half < lngCenter) lngCenter -= resolution;
  else if (refLng - half > lngCenter) lngCenter += resolution;
  return encode(latCenter, lngCenter, area.codeLength);
}
