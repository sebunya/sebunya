/**
 * Browser side of the battery finder's funnel (see pages/api/battery-finder/event.ts).
 * Fire-and-forget: `keepalive` lets the add-to-cart event survive the page
 * navigation that follows it. Nothing personal travels: a device slug, a
 * product id and the event name.
 */
export type FinderEventType = 'RESULT_VIEWED' | 'PRODUCT_VIEWED' | 'ADDED_TO_CART';
export type FinderEventMode = 'FIND_BY_PHONE' | 'SEARCH_CODE' | 'PRODUCT_PAGE' | 'CART';

export interface FinderEvent {
  eventType: FinderEventType;
  mode: FinderEventMode;
  deviceSlug?: string | null;
  productId?: string | null;
  outcome?: string | null;
}

export function sendFinderEvent(event: FinderEvent): void {
  try {
    // An automated browser is not a customer (the relay also drops known crawlers by user agent).
    if (typeof navigator !== 'undefined' && (navigator as Navigator & { webdriver?: boolean }).webdriver) return;
    void fetch('/api/battery-finder/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => undefined);
  } catch {
    /* an old browser without fetch loses one beacon, not the page */
  }
}
