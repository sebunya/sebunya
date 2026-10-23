/**
 * A redirect target with the visitor's query string carried over. Our redirects (recorded redirects, a product's
 * successor, the moved pages) built the target without it, so a link's utm_* and click ids (gclid, fbclid…) were
 * gone before the tag read the URL: the visit counted as Direct and the ad click was lost (2026-10-23 audit).
 * The target's own parameters win over the visitor's of the same name.
 */
export function carryQuery(target: string, search: string): string {
  if (!search || search === '?') return target;
  const hash = target.indexOf('#');
  const path = hash >= 0 ? target.slice(0, hash) : target;
  const frag = hash >= 0 ? target.slice(hash) : '';
  const q = path.indexOf('?');
  const base = q >= 0 ? path.slice(0, q) : path;
  const merged = new URLSearchParams(q >= 0 ? path.slice(q + 1) : '');
  new URLSearchParams(search).forEach((v, k) => { if (!merged.has(k)) merged.append(k, v); });
  const qs = merged.toString();
  return `${base}${qs ? `?${qs}` : ''}${frag}`;
}

/** Where a visit came from: campaign tags, our own short tag and the ad networks' click ids. */
export const CAMPAIGN_PARAM = /^(utm_[a-z]+|ch|gclid|gbraid|wbraid|dclid|fbclid|ttclid|twclid|msclkid|li_fat_id|sccid|epik)$/i;

/**
 * A same-site redirect's target with the request's campaign tags added (only those, and only ones it lacks), or
 * null when there is nothing to carry. Pages answer a signed-out visitor with a redirect to /login?returnTo=… built
 * from the path alone (18 of them), so a loyalty or receipt link from an SMS lost its tag on the way and the visit
 * counted as Direct. Applied once, in middleware, to every redirect (audit 2026-10-23). Never to another site.
 */
export function campaignOnRedirect(location: string, requestUrl: URL): string | null {
  const carry: Array<[string, string]> = [];
  requestUrl.searchParams.forEach((v, k) => { if (CAMPAIGN_PARAM.test(k)) carry.push([k, v]); });
  if (!carry.length) return null;
  let target: URL;
  try { target = new URL(location, requestUrl); } catch { return null; }
  if (target.origin !== requestUrl.origin || location.startsWith('//')) return null;
  let added = false;
  for (const [k, v] of carry) if (!target.searchParams.has(k)) { target.searchParams.append(k, v); added = true; }
  if (!added) return null;
  // Keep the form the page used: a path stays a path.
  return location.startsWith('/') ? `${target.pathname}${target.search}${target.hash}` : target.toString();
}
