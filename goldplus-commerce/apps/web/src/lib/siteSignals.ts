import { track } from './telemetry';
import { SIGNED_UP_COOKIE, hasSignedUpMarker, isMapLink, searchAlreadyCounted, searchTermOf } from './siteSignalRules';

/**
 * Three things a visitor does besides filling a basket, sent like add_to_cart
 * (beacon → our API → GA4 and, where the owner selected it, an ad platform's
 * own standard event): a product search, a new account, and opening the
 * shop's map. Runs on every page (BaseLayout). The search term itself is not
 * put in the event; it is in the page address, as for any results page.
 */
export function recordSiteSignals(): void {
  try {
    const term = searchTermOf(window.location.pathname, window.location.search);
    if (term) {
      let storage: Storage | null = null;
      try { storage = window.sessionStorage; } catch { storage = null; }
      if (!searchAlreadyCounted(term, storage)) track('search');
    }

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
