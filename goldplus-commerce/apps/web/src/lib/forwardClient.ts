/**
 * Headers for an SSR call to the API, carrying the real client's address.
 *
 * WHY THIS EXISTS
 * The storefront's auth pages run server side and call the API from the web
 * container. Without `X-Forwarded-For`, `resolveClientAddress` finds an empty
 * chain and falls back to the web container's own socket address with
 * confidence UNVERIFIED, so `publicAbuseControl` keys EVERY customer to one
 * bucket, and an unverified bucket gets half the budget.
 *
 * The whole storefront therefore shared a handful of sign-in and password-reset
 * attempts per minute: one person fumbling their password could lock out
 * everybody else, and a single visitor could exhaust recovery for the site.
 *
 * The recommendations relay already did this. These are the same two lines, in
 * one place, so the next SSR caller does not have to rediscover them.
 */

export function apiHeaders(
  base: Record<string, string>,
  clientAddress?: string | null,
): Record<string, string> {
  const headers = { ...base };
  try {
    // Astro throws on clientAddress in a prerendered context; the call still
    // works without it, it simply falls back to the shared bucket.
    if (clientAddress) headers['X-Forwarded-For'] = clientAddress;
  } catch {
    /* address is an attribution detail, never a reason to fail the request */
  }
  return headers;
}

/** The common case: a JSON POST attributed to the real visitor. */
export function jsonApiHeaders(clientAddress?: string | null): Record<string, string> {
  return apiHeaders({ 'Content-Type': 'application/json' }, clientAddress);
}
