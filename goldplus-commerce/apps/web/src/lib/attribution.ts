/**
 * First-party marketing attribution capture (last-touch).
 *
 * Runs on every page: reads UTM parameters and the external referrer, keeps a
 * first-touch record (once) and a last-touch record (refreshed whenever a new
 * campaign or external referrer appears), in localStorage. At checkout the
 * last-touch is sent with the order and stored server-side for reporting. No
 * third party, no cookies beyond first-party storage.
 */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
const FIRST = 'gp_attr_first';
const LAST = 'gp_attr_last';

function externalReferrer(): string {
  try {
    const r = document.referrer || '';
    if (!r) return '';
    return new URL(r).host && new URL(r).host !== location.host ? r.slice(0, 500) : '';
  } catch {
    return '';
  }
}

function readUtm(): Record<string, string> {
  const p = new URLSearchParams(location.search);
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = p.get(k);
    if (v) out[k] = v.slice(0, 160);
  }
  return out;
}

export function captureAttribution(): void {
  try {
    const utm = readUtm();
    const hasUtm = Object.keys(utm).length > 0;
    const ref = externalReferrer();
    const now = new Date().toISOString();
    const touch = { ...utm, referrer: ref, landingPath: location.pathname.slice(0, 300), at: now };

    if (!localStorage.getItem(FIRST)) localStorage.setItem(FIRST, JSON.stringify(touch));
    // Last-touch refreshes on a fresh campaign or a fresh external referral; also
    // seeds on the very first page so a direct visit still has a last-touch.
    if (hasUtm || ref || !localStorage.getItem(LAST)) localStorage.setItem(LAST, JSON.stringify(touch));
  } catch {
    /* storage disabled — attribution is simply not captured */
  }
}

function sourceFromReferrer(ref: string): string {
  try {
    const host = new URL(ref).host.replace(/^www\./, '');
    if (!host) return '';
    if (/google\./.test(host)) return 'google';
    if (/facebook\.|fb\./.test(host)) return 'facebook';
    if (/instagram\./.test(host)) return 'instagram';
    if (/t\.co|twitter\.|x\.com/.test(host)) return 'x';
    if (/tiktok\./.test(host)) return 'tiktok';
    if (/youtube\.|youtu\.be/.test(host)) return 'youtube';
    if (/wa\.me|whatsapp\./.test(host)) return 'whatsapp';
    return host;
  } catch {
    return '';
  }
}

export interface CheckoutAttribution {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
  landingPath: string | null;
  referrer: string | null;
  firstAt: string | null;
  /** Ad-network click ids seen in the last 30 days (see lib/telemetry). */
  clickIds?: Record<string, string>;
}

const CLICK_KEYS = ['gclid', 'wbraid', 'gbraid', 'ttclid', 'twclid', 'li_fat_id', 'epik', 'msclkid', 'ScCid', 'clickid', 'click_id'];
const CLICK_STORE = '_gp_ad_click';
const CLICK_WINDOW_MS = 30 * 864e5;

/**
 * The last ad click, kept 30 days FROM THE CLICK. Called on every page (from
 * BaseLayout), so an ad landing on the home page, a category or a blog post is
 * recorded before the shopper navigates away and the query string is gone.
 * Last click wins: a new ad click replaces the previous one entirely, so an old
 * gclid never rides along with a new network's click and both claim the sale.
 * `src` is the utm_source of that click: it tells two networks that use the
 * same parameter name (clickid) apart. Only URL parameters, never cookies.
 */
export function recordAdClick(): void {
  try {
    const p = new URLSearchParams(location.search);
    const ids: Record<string, string> = {};
    for (const k of CLICK_KEYS) { const v = p.get(k); if (v && v.length <= 512) ids[k] = v; }
    if (Object.keys(ids).length === 0) return;
    localStorage.setItem(CLICK_STORE, JSON.stringify({ ids, src: (p.get('utm_source') || '').toLowerCase().slice(0, 60), at: Date.now() }));
  } catch { /* storage unavailable */ }
}

function recentClickIds(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(CLICK_STORE) || '{}');
    if (!raw.at || Date.now() - Number(raw.at) > CLICK_WINDOW_MS) return {};
    const out: Record<string, string> = {};
    for (const k of CLICK_KEYS) if (typeof raw.ids?.[k] === 'string') out[k] = raw.ids[k];
    if (Object.keys(out).length && raw.src) out.src = String(raw.src);
    return out;
  } catch {
    return {};
  }
}

export function getCheckoutAttribution(): CheckoutAttribution | null {
  try {
    const last = JSON.parse(localStorage.getItem(LAST) || '{}');
    const first = JSON.parse(localStorage.getItem(FIRST) || '{}');
    const refSource = last.referrer ? sourceFromReferrer(last.referrer) : '';
    const source = last.utm_source || refSource || null;
    const medium = last.utm_medium || (last.utm_source ? 'campaign' : last.referrer ? 'referral' : null) || null;
    return {
      source,
      medium,
      campaign: last.utm_campaign || null,
      term: last.utm_term || null,
      content: last.utm_content || null,
      landingPath: last.landingPath || first.landingPath || null,
      referrer: last.referrer || first.referrer || null,
      firstAt: first.at || null,
      clickIds: recentClickIds(),
    };
  } catch {
    return null;
  }
}
