/**
 * The dispatch origin, and the guard that keeps it on the right continent.
 *
 * WHY THIS GUARD EXISTS
 * The origin was supplied as 0°18'48"N, 32°34'39"E with a decimal rendering of
 * "0.3133, 0.5775". The latitude is right; the longitude is not. 32°34'39"
 * converts to 32.5775, and `34/60 + 39/3600` is 0.5775 EXACTLY — the whole
 * degrees component was dropped in conversion. The bad pair sits in the Gulf of
 * Guinea, about 3,600 km from Kampala, and every quote computed from it would
 * have been silently enormous.
 *
 * That is a reproducible class of error, not a typo, so it gets a permanent
 * test rather than a corrected constant. The same bounding box also catches
 * (0, 0), which is what a missing origin row degrades into — so one guard
 * covers both failures.
 */

/** Uganda's approximate bounding box. Deliberately generous. */
export const UGANDA_BBOX = {
  minLat: -1.5,
  maxLat: 4.3,
  minLng: 29.5,
  maxLng: 35.1,
} as const;

export interface DeliveryOriginRecord {
  originCode: string;
  name: string;
  role: string;
  street: string | null;
  landmarkPrimary: string | null;
  landmarkSecondary: string | null;
  areaSlug: string | null;
  district: string | null;
  corridor: string | null;
  distanceBand: string | null;
  latitude: number;
  longitude: number;
  coordSource: string | null;
  coordAnchor: string | null;
  coordConfidence: string | null;
  active: boolean;
}

export type OriginRejection =
  | 'OUTSIDE_UGANDA'
  | 'NON_FINITE_COORDINATE'
  | 'NULL_ISLAND';

export function isWithinUganda(lat: number, lng: number): boolean {
  return (
    lat >= UGANDA_BBOX.minLat &&
    lat <= UGANDA_BBOX.maxLat &&
    lng >= UGANDA_BBOX.minLng &&
    lng <= UGANDA_BBOX.maxLng
  );
}

/**
 * Validate a coordinate pair before anything is allowed to compute from it.
 * `NULL_ISLAND` is reported separately from `OUTSIDE_UGANDA` because they have
 * different causes — a dropped degrees component versus a missing row — and an
 * operator reading an alert deserves to know which.
 */
export function validateOriginCoordinates(
  lat: number,
  lng: number,
): { ok: true } | { ok: false; reason: OriginRejection } {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: 'NON_FINITE_COORDINATE' };
  }
  if (lat === 0 && lng === 0) return { ok: false, reason: 'NULL_ISLAND' };
  if (!isWithinUganda(lat, lng)) return { ok: false, reason: 'OUTSIDE_UGANDA' };
  return { ok: true };
}

/**
 * Dispatch instructions. Both landmarks, primary first — the brief is explicit
 * that Uhuru Restaurant leads because that is what a person collecting asks
 * for, with Pioneer Mall as the wider fallback.
 */
export function dispatchInstructions(origin: DeliveryOriginRecord): string[] {
  return [origin.street, origin.landmarkPrimary, origin.landmarkSecondary].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  );
}

/**
 * Resolve the origin a quote must compute from. There is no default: no active
 * origin means no quote, and the caller alerts rather than substituting a
 * coordinate.
 */
export type OriginResolution =
  | { ok: true; origin: DeliveryOriginRecord }
  | { ok: false; reason: 'NO_ACTIVE_ORIGIN' | OriginRejection };

export function resolveDispatchOrigin(origins: readonly DeliveryOriginRecord[]): OriginResolution {
  const active = origins.filter((o) => o.active);
  if (active.length === 0) return { ok: false, reason: 'NO_ACTIVE_ORIGIN' };
  const primary = active.find((o) => o.role === 'primary_dispatch_hub') ?? active[0];
  const check = validateOriginCoordinates(primary.latitude, primary.longitude);
  if (!check.ok) return { ok: false, reason: check.reason };
  return { ok: true, origin: primary };
}

/** Straight-line distance in km. Used only where a measured centroid exists. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
