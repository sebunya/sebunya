/**
 * Cross-site request refusal for state-changing storefront requests.
 *
 * WHAT WAS MISSING
 * Checkout is a top-level form POST to the Astro server, and there was no origin
 * check of any kind. The intent cookie is SameSite=Lax, which means a cross-site
 * POST arrives WITHOUT it — and the checkout page's response to a missing cookie
 * was to mint a fresh guest intent and carry on. So a request a browser had already
 * marked as cross-site was answered by manufacturing a brand-new identity for it,
 * which is the opposite of what a missing cookie should mean.
 *
 * SameSite is a useful mitigation but not a control: it is enforced by the browser,
 * varies by version, does not apply to non-browser clients, and says nothing about
 * a same-site-but-different-host request. The server has to decide for itself.
 *
 * WHY NOT A CSRF TOKEN
 * A synchroniser token would work, but it needs its own issuance, storage and
 * rotation, and it protects exactly what an origin check already protects here.
 * `Sec-Fetch-Site` is sent by every current browser, is not settable by page script
 * (it is a forbidden header), and states the browser's own conclusion about the
 * request. Origin is the fallback for the rest. A token can be added later without
 * changing this boundary; shipping neither was the actual defect.
 *
 * CONFIGURATION
 * The primary signal needs no configuration, so this closes the hole for every
 * current browser on a deployment that sets nothing — which matters, because a
 * guard that refuses all POSTs until an operator adds a variable is a guard that
 * gets reverted. Setting PUBLIC_SITE_ORIGINS (comma-separated) strengthens the
 * Origin/Referer fallback for older clients by naming the hosts explicitly instead
 * of trusting the request's own Host header.
 */

export type OriginDecision =
  | { allowed: true; basis: 'SEC_FETCH_SITE' | 'ORIGIN' | 'REFERER' }
  | { allowed: false; reason: 'CROSS_SITE' | 'ORIGIN_MISMATCH' | 'NO_ORIGIN_EVIDENCE' };

/**
 * Hosts this storefront answers on, as configured.
 *
 * Returns an empty list when nothing is set — deliberately, so the caller can tell
 * "configured to allow nothing" from "not configured" and pick its own fallback.
 * Naming the hosts here is the strong form: validating a request's Origin against
 * the same request's Host header compares one caller-supplied value with another,
 * and behind a reverse proxy the forwarded Host is exactly what an attacker sets.
 */
export function allowedHosts(env: Record<string, string | undefined>): string[] {
  const configured = (env.PUBLIC_SITE_ORIGINS || env.PUBLIC_SITE_URL || '').trim();
  return configured
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(hostOf)
    .filter((host): host is string => host !== null);
}

function requestHost(request: Request): string {
  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return '';
  }
}

/** Host (with port) of a URL or bare host string, or null if unparseable. */
function hostOf(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Decides whether a state-changing request may proceed.
 *
 * Fails CLOSED. A request carrying no origin evidence at all is refused rather than
 * assumed same-site: "no header" is precisely what a hand-rolled cross-origin
 * request looks like, and a same-origin browser form POST always carries at least
 * one of these.
 */
export function checkRequestOrigin(
  request: Request,
  env: Record<string, string | undefined>,
): OriginDecision {
  // Configured hosts are the strong form. When none are configured the request's
  // own URL host is used instead, which is weaker — behind a reverse proxy the
  // forwarded Host is attacker-settable, so it compares one caller-supplied value
  // against another. It is still the right default: the alternative is refusing
  // every POST on any deployment that has not set the variable, and the primary
  // signal below needs no configuration at all.
  const configured = allowedHosts(env);
  const hosts = configured.length > 0 ? configured : [requestHost(request)].filter(Boolean);

  // The browser's own conclusion, and page script cannot set it.
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite) {
    if (fetchSite === 'same-origin' || fetchSite === 'same-site') {
      return { allowed: true, basis: 'SEC_FETCH_SITE' };
    }
    // `cross-site` and `none` are both refused for a POST. `none` means the
    // navigation had no initiator — a typed URL or a bookmark — which cannot be a
    // form submission of this page.
    return { allowed: false, reason: 'CROSS_SITE' };
  }

  const origin = request.headers.get('origin');
  if (origin) {
    // Firefox and some proxies send `Origin: null` for privacy-sensitive
    // navigations. It is not a host, so it cannot match one.
    const host = origin === 'null' ? null : hostOf(origin);
    return host && hosts.includes(host)
      ? { allowed: true, basis: 'ORIGIN' }
      : { allowed: false, reason: 'ORIGIN_MISMATCH' };
  }

  // Referer is the last resort: it can be suppressed by policy, so its ABSENCE
  // proves nothing, but when present its host is still meaningful.
  const referer = request.headers.get('referer');
  if (referer) {
    const host = hostOf(referer);
    return host && hosts.includes(host)
      ? { allowed: true, basis: 'REFERER' }
      : { allowed: false, reason: 'ORIGIN_MISMATCH' };
  }

  return { allowed: false, reason: 'NO_ORIGIN_EVIDENCE' };
}

/** What the customer is told. Never names the header that failed. */
export const CROSS_SITE_MESSAGE =
  'This request could not be verified as coming from our site. Please reload the page and try again.';
