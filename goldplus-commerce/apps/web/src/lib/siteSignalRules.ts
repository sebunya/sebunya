/**
 * Pure rules for the site signals (search, new account, shop directions),
 * kept free of browser globals so they are unit-tested directly.
 */

/** Set by the register page on success, read and cleared by the next page. Holds nothing about the person. */
export const SIGNED_UP_COOKIE = 'gp_signed_up';

/** The term of a storefront search on this URL, or '' (the shop page with `search` or `q`). */
export function searchTermOf(pathname: string, search: string): string {
  if (!/^\/shop\/?$/.test(pathname)) return '';
  const p = new URLSearchParams(search);
  return (p.get('search') ?? p.get('q') ?? '').trim().toLowerCase().slice(0, 120);
}

/**
 * True when this term was the last one counted in this tab (page two of the
 * same results, a sort, a reload); marks it counted otherwise.
 */
export function searchAlreadyCounted(term: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem('_gp_last_search') === term) return true;
    storage.setItem('_gp_last_search', term);
  } catch { /* storage blocked: counted once for this page view */ }
  return false;
}

/** True when a Cookie header / document.cookie string carries the just-registered marker. */
export function hasSignedUpMarker(cookie: string): boolean {
  return cookie.split(';').some((c) => c.trim() === `${SIGNED_UP_COOKIE}=1`);
}

/** A link that opens a map (Google Maps in its documented link forms): the shop's directions link. */
export function isMapLink(href: string): boolean {
  let url: URL;
  try { url = new URL(href); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const h = url.hostname.replace(/^www\./, '');
  return h === 'maps.app.goo.gl' || h === 'maps.google.com'
    || (h === 'goo.gl' && url.pathname.startsWith('/maps'))
    || (/^google\.[a-z.]{2,6}$/.test(h) && url.pathname.startsWith('/maps'));
}
