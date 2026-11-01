import type { AstroCookies } from 'astro';
import { readGuestMemory } from './guestMemory';

/**
 * "Deliver to": the one area the storefront prices and promises for, site-wide (2026-10-16).
 *
 * It is the place the CUSTOMER told us, in this order of precedence:
 *   1. what they chose in "Deliver to" (cookie below), or the area of their last checkout (written there too);
 *   2. the area in this device's checkout memory (guest memory, written at checkout since 2026-10-13);
 *   3. a signed-in customer's default saved address (pages that already fetch the account pass it in).
 * Never inferred from an IP address (location brief: "never infer from IP alone"). The cookie holds the AREA only
 * — slug, district, label — never coordinates, never an address line, never a name.
 *
 * It is a service cookie (it makes the delivery fee shown match where the customer said they are), not tracking:
 * nothing reads it but this site's own pages.
 */
export const DELIVER_TO_COOKIE = 'gp_deliver_to';
const MAX_AGE = 60 * 60 * 24 * 180;

export interface DeliveryPlace {
  areaSlug: string | null;
  district: string;
  /** "Najjera, Wakiso", or the district alone. */
  label: string;
  source: 'chosen' | 'last_checkout' | 'account';
}

const SLUG = /^[a-z0-9-]{3,160}$/;
const clean = (s: unknown, max: number): string =>
  Array.from(String(s ?? ''))
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch !== '<' && ch !== '>')
    .join('')
    .trim()
    .slice(0, max);

/**
 * The area inside a location-picker payload (or a stored place). Coordinates, written directions and pickup
 * points are dropped: "Deliver to" is an area, and a pickup point is not a delivery destination.
 */
export function placeFromPayload(raw: unknown, source: DeliveryPlace['source']): DeliveryPlace | null {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim().startsWith('{')) return null;
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.manual || o.pickupPointId) return null;
  const district = clean(o.district, 60);
  if (!district) return null;
  const areaSlug = typeof o.areaSlug === 'string' && SLUG.test(o.areaSlug) ? o.areaSlug : null;
  const area = clean(o.area, 80);
  const label = clean(o.label ?? o.displayLabel, 120) || (area && area !== district ? `${area}, ${district}` : district);
  return { areaSlug, district, label, source };
}

export function readChosenPlace(cookies: AstroCookies): DeliveryPlace | null {
  try {
    const raw = cookies.get(DELIVER_TO_COOKIE)?.value;
    if (!raw) return null;
    const place = placeFromPayload(decodeURIComponent(raw), 'chosen');
    return place;
  } catch {
    return null;
  }
}

export function writeChosenPlace(cookies: AstroCookies, place: Pick<DeliveryPlace, 'areaSlug' | 'district' | 'label'>, secure: boolean): void {
  try {
    const value = JSON.stringify({ areaSlug: place.areaSlug, district: place.district, label: place.label });
    cookies.set(DELIVER_TO_COOKIE, encodeURIComponent(value), { path: '/', maxAge: MAX_AGE, httpOnly: true, sameSite: 'lax', secure });
  } catch {
    /* a convenience */
  }
}

export function forgetChosenPlace(cookies: AstroCookies): void {
  try {
    cookies.delete(DELIVER_TO_COOKIE, { path: '/' });
  } catch {
    /* nothing to forget */
  }
}

/** The customer's place from this device alone (no network): chosen, else their last checkout here. */
export function knownDeliveryPlace(cookies: AstroCookies, request?: Request): DeliveryPlace | null {
  return readChosenPlace(cookies) ?? placeFromPayload(readGuestMemory(cookies, request).locationJson, 'last_checkout');
}

/** A safe same-site path to return to after choosing a place. */
export function safeBackPath(back: unknown): string {
  const p = String(back ?? '');
  return p.startsWith('/') && !p.startsWith('//') && !p.includes('\\') && p.length <= 300 ? p : '/';
}
