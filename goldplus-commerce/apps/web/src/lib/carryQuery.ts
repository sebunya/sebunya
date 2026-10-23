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
