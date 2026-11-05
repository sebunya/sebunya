/**
 * N4 (2026-11-05): a response that sets a cookie must never be kept by a
 * shared cache. Astro attaches the cookies a request queued (session renewal,
 * visitor id, basket) to WHATEVER response the middleware returns, after the
 * middleware has finished, so a page that declared itself `public` (Markdown
 * for agents, the 410 "no longer available" page) could carry one visitor's
 * Set-Cookie into a CDN or proxy and hand it to the next visitor.
 *
 * Narrow on purpose: only a response that is BOTH publicly cacheable AND
 * carries (or will carry) a cookie is downgraded to `private, no-store`.
 * Anonymous agent fetches without cookies keep their public caching.
 */
export function hasPendingCookies(cookies: { headers(): Iterable<string> } | null | undefined): boolean {
  if (!cookies) return false;
  for (const _ of cookies.headers()) return true;
  return false;
}

export function keepCookiesOutOfSharedCaches(response: Response, pendingCookies: boolean): Response {
  const cc = response.headers.get('cache-control') ?? '';
  if (!/\bpublic\b|s-maxage/i.test(cc)) return response;
  if (!pendingCookies && !response.headers.has('set-cookie')) return response;
  try {
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch {
    // Immutable headers (a fetched or redirect Response): rebuild.
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'private, no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}
