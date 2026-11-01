/**
 * The Domain attribute for the analytics visitor id (`_fp_cid`).
 *
 * The collector runs on api.shopgoldplus.com, and a host-only cookie set by
 * shopgoldplus.com is never sent to a sibling subdomain. So the API never saw
 * the server-set id, and its "server visitor id wins over the page's claim"
 * protection (D-012/D-013) never ran in production. Scoped to the registrable
 * domain, the same value reaches the collector; on any other host (localhost,
 * a preview) the cookie stays host-only, as before.
 */
const SITE_DOMAIN = 'shopgoldplus.com';

export function visitorCookieDomain(hostname: string): string | undefined {
  const h = (hostname || '').toLowerCase();
  return h === SITE_DOMAIN || h.endsWith(`.${SITE_DOMAIN}`) ? SITE_DOMAIN : undefined;
}
