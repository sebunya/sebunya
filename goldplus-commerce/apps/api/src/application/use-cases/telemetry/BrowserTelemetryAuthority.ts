import type { BrowserTelemetryEvent } from '@goldplus/shared';

/**
 * What a browser may NOT claim about itself on a telemetry event.
 *
 * The v2 collector refused these, but the legacy v1 routes (/telemetry/collect
 * and the array form of /collect/batch) passed them straight into the outbox,
 * where the dispatcher set GA4's `uid` from user_id and handed hashed_email /
 * phone to the ad platforms. The storefront never sends any of them, so on
 * the browser path they could only ever be a forgery: an anonymous script
 * stitching its visits onto someone else's User-ID, or attaching a victim's
 * hashed email to an AddToCart conversion.
 *
 * Identity is the server's: the signed-in session, the checkout, the order.
 */
export const BROWSER_FORBIDDEN_USER_FIELDS = [
  'user_id',
  'ip_address',
  'user_agent',
  'hashed_email',
  'hashed_phone',
  'hashed_phone_plus',
  'hashed_email_google',
] as const;

/**
 * Upper bound on a browser-reported money amount, in UGX.
 *
 * Not a catalogue fact — a plausibility guard. The schema bounded nothing, so a
 * single forged add_to_cart put 999,999,999,999 UGX into live GA4. No basket a
 * browser can build on this storefront comes near this figure.
 */
export const MAX_BROWSER_ECOMMERCE_UGX = 200_000_000;

/** True when the event carries a value or item price no real basket could. */
export function exceedsBrowserValueCeiling(event: { ecommerce?: { value?: number; items?: Array<{ price?: number }> } }): boolean {
  const e = event.ecommerce;
  if (!e) return false;
  if (typeof e.value === 'number' && e.value > MAX_BROWSER_ECOMMERCE_UGX) return true;
  return (e.items ?? []).some((i) => typeof i?.price === 'number' && i.price > MAX_BROWSER_ECOMMERCE_UGX);
}

/**
 * The event with every server-authority field removed, and the server's own
 * first-party visitor id (`_fp_cid`) in place of the page's claim when the
 * server has one. A page may observe; it may not name who it is.
 */
export function withoutBrowserAuthority<T extends BrowserTelemetryEvent>(event: T, serverVisitorId?: string | null): T {
  const source = (event.user_data ?? {}) as Record<string, unknown>;
  const userData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if ((BROWSER_FORBIDDEN_USER_FIELDS as readonly string[]).includes(key)) continue;
    userData[key] = value;
  }
  if (serverVisitorId) userData.fp_client_id = serverVisitorId;
  if (!event.user_data && Object.keys(userData).length === 0) return { ...event };
  return { ...event, user_data: userData as T['user_data'] };
}
