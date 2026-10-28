/**
 * Pure rules for the site signals (search, new account, shop directions),
 * kept free of browser globals so they are unit-tested directly.
 */

/** Set by the register page on success, read and cleared by the next page. Holds nothing about the person. */
export const SIGNED_UP_COOKIE = 'gp_signed_up';

/**
 * The term of a storefront search on this URL, or '' (the shop page with `search` or `q`,
 * and the battery finder's `q`: a phone or a battery code typed is a search too, and until
 * 2026-10-28 GA4 never heard about any of them).
 */
export function searchTermOf(pathname: string, search: string): string {
  if (!/^\/(shop|battery-finder)\/?$/.test(pathname)) return '';
  const p = new URLSearchParams(search);
  return (p.get('search') ?? p.get('q') ?? '').trim().toLowerCase().slice(0, 120);
}

/** The term a search form carried as it submitted, read once by the results page (siteSignals). */
export const TYPED_SEARCH_KEY = '_gp_typed_search';

/**
 * The term a submitting form searches for, normalised as searchTermOf reads it back, or '' when the form is not a
 * shop or battery-finder search. Read from the form's own fields, so it is exactly what the visitor typed.
 */
export function submittedSearchTerm(actionPath: string, fields: { get(name: string): unknown }): string {
  if (!/^\/(shop|battery-finder)\/?$/.test(actionPath)) return '';
  const v = fields.get('search') ?? fields.get('q');
  return typeof v === 'string' ? v.trim().toLowerCase().slice(0, 120) : '';
}

/**
 * A search counts only when someone typed it: the results page sees the same term a search form just submitted.
 * The menu's links (/battery-finder?q=Tecno, /shop?category=power&q=adapter), a guide's link to a pre-filled finder
 * and a shared results link all open the same addresses, and every one was reported to GA4 and the ad platforms as a
 * search, so "what people search for" was partly "what the menu offers" (2026-10-29). Read once, then cleared.
 */
export function searchWasTyped(term: string, storage: Pick<Storage, 'getItem' | 'removeItem'> | null): boolean {
  if (!storage || !term) return false;
  try {
    const typed = storage.getItem(TYPED_SEARCH_KEY);
    storage.removeItem(TYPED_SEARCH_KEY);
    return typed === term;
  } catch {
    return false;
  }
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
