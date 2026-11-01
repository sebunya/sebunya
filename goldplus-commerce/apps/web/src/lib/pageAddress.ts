/**
 * One address per page: a page's address has no trailing slash (the root aside).
 *
 * /products/<slug>/ once served a second copy of every product page; /shop/,
 * /phone-batteries/ and every other route still did on 2026-10-28, each a
 * duplicate a crawler could index. The middleware sends the twin to the real
 * address with a 301. Read-only requests only (a form POST to a slashed
 * address is answered where it landed), and never the API relays, the built
 * assets or the machine endpoints. No internal link ends in a slash, so this
 * only ever catches an outside link or a typed address.
 *
 * Returns the address to redirect to, query string kept, or null.
 */
export function trailingSlashTarget(method: string, pathname: string, search = ''): string | null {
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (pathname === '/' || !pathname.endsWith('/')) return null;
  if (/^\/(api|_astro|\.well-known)\//.test(pathname)) return null;
  const bare = pathname.replace(/\/+$/, '');
  // "//" collapses to the root, never to an empty Location.
  return `${bare || '/'}${search}`;
}
