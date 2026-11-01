import { track } from './telemetry';
import { SIGNED_UP_COOKIE, TYPED_SEARCH_KEY, hasSignedUpMarker, isMapLink, searchAlreadyCounted, searchTermOf, searchWasTyped, submittedSearchTerm } from './siteSignalRules';

/**
 * Three things a visitor does besides filling a basket, sent like add_to_cart
 * (beacon → our API → GA4 and, where the owner selected it, an ad platform's
 * own standard event): a product search (with the term searched for), a new
 * account, and opening the shop's map. Runs on every page (BaseLayout).
 */
export function recordSiteSignals(): void {
  try {
    // Every storefront page, once per load: without it an ad platform hears of a
    // visitor only when they open a product, so a visit that ends on the home
    // page or a category can never be remarketed to.
    track('page_seen');

    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { storage = null; }
    const term = searchTermOf(window.location.pathname, window.location.search);
    // Only a search someone typed (siteSignalRules.searchWasTyped); a menu link or a shared results link is not one.
    if (term && searchWasTyped(term, storage) && !searchAlreadyCounted(term, storage)) track('search', { search_term: term });
    // Every search form on the site marks its term as it submits; the results page reads it back above.
    document.addEventListener('submit', (ev) => {
      try {
        const form = ev.target as HTMLFormElement | null;
        if (!form || form.method.toLowerCase() === 'post') return;
        const typed = submittedSearchTerm(new URL(form.action, window.location.href).pathname, new FormData(form));
        if (typed) storage?.setItem(TYPED_SEARCH_KEY, typed);
      } catch { /* measurement never breaks a page */ }
    }, { capture: true });

    if (hasSignedUpMarker(document.cookie)) {
      // Cleared first: one account is one sign_up, whatever happens next.
      document.cookie = `${SIGNED_UP_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
      track('sign_up');
    }

    // Once per page view: a second tap on the same map link is the same intent.
    let directionsCounted = false;
    document.addEventListener('click', (ev) => {
      if (directionsCounted) return;
      const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || !isMapLink(a.href)) return;
      directionsCounted = true;
      track('find_location');
    }, { capture: true });
  } catch { /* measurement never breaks a page */ }
}
