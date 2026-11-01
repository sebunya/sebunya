import { apiBase } from './api';
import { safeReturnTo } from './safeReturnTo';

/**
 * U6 AC6 — "does this path have a recorded redirect?" (product slug changes and
 * manual rows in the redirects table), asked by a ROUTE before it gives up.
 *
 * WHY IT LIVES HERE AND NOT ONLY IN 404.astro
 * 404.astro asks the same question, but no storefront path reaches it in a way
 * that lets it redirect. products/[slug].astro and [hub]/[...child].astro both
 * `return Astro.redirect('/404', 404)`, and Astro (4.16 App.#renderError →
 * #mergeResponses) keeps that first 404 status and concatenates the headers.
 * The shopper got HTTP 404, an empty body and `location: <target>, /404`, which
 * no browser follows and every crawler records as a dead URL, while the lookup
 * still counted a "hit" on the admin Redirects screen. The answer has to come
 * from the route itself, BEFORE it hands over to the 404 page.
 *
 * Fail-open with a short timeout: an error, a miss or an unsafe target returns
 * null and the caller renders its normal 404. Only the 404 path pays this cost.
 */

export interface RecordedRedirect {
  target: string;
  status: 301 | 302;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const RECORDED_REDIRECT_TIMEOUT_MS = 400;

export async function findRecordedRedirect(
  requestPath: string,
  opts: { fetchImpl?: FetchLike; base?: string } = {},
): Promise<RecordedRedirect | null> {
  if (!requestPath || !requestPath.startsWith('/') || requestPath === '/404') return null;
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = opts.base ?? apiBase;
  try {
    const res = await fetchImpl(`${base}/seo/resolve-redirect?path=${encodeURIComponent(requestPath)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(RECORDED_REDIRECT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json: any = await res.json().catch(() => null);
    const to = json?.data?.to;
    if (!json?.success || typeof to !== 'string' || !to.startsWith('/')) return null;
    // startsWith('/') alone still admits "//evil.example" and "/\evil.example".
    // An admin-configured redirect is data, not a licence to leave the site.
    const target = safeReturnTo(to, '');
    if (!target) return null;
    // A row pointing at the path we are already on would loop forever.
    if (target === requestPath) return null;
    return { target, status: json?.data?.statusCode === 302 ? 302 : 301 };
  } catch {
    return null;
  }
}
