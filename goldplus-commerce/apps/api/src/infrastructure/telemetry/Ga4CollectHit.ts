import type { CanonicalTelemetryEvent } from '@goldplus/shared';

/**
 * A canonical server event as a GA4 collection hit (`/g/collect`), the format
 * the server container's built-in GA4 client already understands. No custom
 * client template is needed in the tagging server: the same client that
 * receives the browser's hits receives ours, and the same GA4 tag forwards both.
 *
 * `cid` is our first-party visitor id (`_fp_cid`). The web container sets GA's
 * client_id to that same value, so a purchase confirmed here (after payment,
 * where no browser is present) joins the visit that led to it.
 *
 * Returns null when there is no visitor id: a hit without one would invent a
 * visitor, and GA would count a user who never existed.
 */
/** A real SKU (not a placeholder such as "Needs Business Confirmation"), else the product id. */
export function ga4ItemId(it: { item_id: string; item_sku?: string }): string {
  const sku = (it.item_sku ?? '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(sku) && !/pending/i.test(sku) ? sku : it.item_id;
}

export function ga4CollectHit(event: CanonicalTelemetryEvent, measurementId: string): URLSearchParams | null {
  const cid = event.user_data?.fp_client_id?.trim();
  if (!cid) return null;
  const p = new URLSearchParams();
  p.set('v', '2');
  p.set('tid', measurementId);
  p.set('cid', cid);
  p.set('en', event.event_name);
  p.set('ep.event_id', event.event_id);
  // The visit's GA4 session: without it GA opens a new session for a server
  // hit, and the sale lands under direct/(not set) in every acquisition report.
  if (event.user_data?.ga_session_id) {
    p.set('sid', event.user_data.ga_session_id);
    if (event.user_data.ga_session_number) p.set('sct', String(event.user_data.ga_session_number));
    p.set('seg', '1');
  }
  if (event.user_data?.user_id) p.set('uid', event.user_data.user_id);
  if (event.page_location) p.set('dl', event.page_location);
  if (event.page_referrer) p.set('dr', event.page_referrer);
  if (event.page_title) p.set('dt', event.page_title);
  const e = event.ecommerce;
  if (e) {
    p.set('cu', e.currency || 'UGX');
    if (e.transaction_id) p.set('ep.transaction_id', e.transaction_id);
    if (e.value != null) p.set('epn.value', String(e.value));
    if (e.shipping != null) p.set('epn.shipping', String(e.shipping));
    if (e.tax != null) p.set('epn.tax', String(e.tax));
    if (e.coupon) p.set('ep.coupon', e.coupon);
    (e.items ?? []).slice(0, 200).forEach((it, i) => {
      // GA4 item encoding: key-prefixed fields joined by '~'. '~' inside a value would split it.
      const clean = (v: unknown) => String(v).replace(/~/g, '-');
      // 2026-10-17: the SKU when known — the Merchant Center feed's g:id — so GA4 audiences shared with Google Ads
      // drive dynamic retargeting (the product someone viewed). Our own records keep the product id.
      const f = [`id${clean(ga4ItemId(it))}`];
      if (it.item_name) f.push(`nm${clean(it.item_name)}`);
      if (it.price != null) f.push(`pr${it.price}`);
      if (it.quantity != null) f.push(`qt${it.quantity}`);
      if (it.item_category) f.push(`ca${clean(it.item_category)}`);
      if (it.item_brand) f.push(`br${clean(it.item_brand)}`);
      if (it.item_variant) f.push(`va${clean(it.item_variant)}`);
      p.set(`pr${i + 1}`, f.join('~'));
    });
  }
  // GA4's recommended `search` event names its term `search_term`.
  if (event.event_name === 'search' && event.search_term) p.set('ep.search_term', event.search_term);
  return p;
}
