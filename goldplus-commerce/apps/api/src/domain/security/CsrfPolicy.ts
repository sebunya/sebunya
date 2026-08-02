/**
 * CSRF policy. Pure domain — no Hono, config or crypto.
 *
 * A cross-site request forgery rides a browser's ambient credentials — a cookie
 * the browser attaches automatically. Bearer-token requests are not forgeable
 * this way (script must read and set the header, which the same-origin policy
 * forbids cross-site), so the control targets exactly the dangerous shape:
 * a STATE-CHANGING method that carries a COOKIE. Origin (with a Referer
 * fallback) must match an allowlisted web origin, and genuine provider callbacks
 * are the only exemption.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

export function isStateChanging(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/** True when the request presents an ambient cookie credential. */
export function isCookieAuthenticated(cookieHeader: string | null | undefined): boolean {
  return typeof cookieHeader === 'string' && cookieHeader.trim().length > 0;
}

/**
 * Genuine provider callbacks (payment webhooks/IPN) cannot send an Origin and
 * are authenticated by HMAC signature instead, so they are the one exemption.
 * Kept narrow and explicit — an over-broad exemption is a CSRF hole.
 */
export function isCsrfExempt(path: string): boolean {
  const p = path.toLowerCase();
  return p === '/webhooks' || p.startsWith('/webhooks/');
}

/** The scheme+host+port of a URL, lowercased, or null if unparseable. */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Resolve the request's origin: the Origin header if present, else the origin
 * derived from Referer. Returns null when neither is usable — which, for a
 * cookie-authenticated state change, must be treated as a failure, not a pass.
 */
export function resolveRequestOrigin(
  originHeader: string | null | undefined,
  refererHeader: string | null | undefined,
): string | null {
  if (originHeader && originHeader !== 'null') {
    return originOf(originHeader);
  }
  return originOf(refererHeader);
}

export function originAllowed(origin: string | null, allowlist: readonly string[]): boolean {
  if (!origin) return false;
  return allowlist.some((a) => originOf(a) === origin);
}

export type CsrfDecision = { action: 'ALLOW' } | { action: 'BLOCK'; reason: string };

/**
 * The whole decision. ALLOW for safe methods, non-cookie (Bearer) requests, and
 * exempt provider callbacks; otherwise the request must carry an allowlisted
 * origin.
 */
export function decideCsrf(input: {
  method: string;
  path: string;
  cookieHeader: string | null | undefined;
  originHeader: string | null | undefined;
  refererHeader: string | null | undefined;
  allowlist: readonly string[];
}): CsrfDecision {
  if (!isStateChanging(input.method)) return { action: 'ALLOW' };
  if (isCsrfExempt(input.path)) return { action: 'ALLOW' };
  if (!isCookieAuthenticated(input.cookieHeader)) return { action: 'ALLOW' }; // Bearer/no-cookie: not forgeable
  const origin = resolveRequestOrigin(input.originHeader, input.refererHeader);
  if (!origin) return { action: 'BLOCK', reason: 'no_origin_or_referer' };
  if (!originAllowed(origin, input.allowlist)) return { action: 'BLOCK', reason: 'origin_not_allowed' };
  return { action: 'ALLOW' };
}
