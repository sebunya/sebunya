/**
 * First-party marketing attribution capture (last-touch).
 *
 * Runs on every page: reads UTM parameters and the external referrer, keeps a
 * first-touch record (once) and a last-touch record (refreshed whenever a new
 * campaign or external referrer appears), in localStorage. At checkout the
 * last-touch is sent with the order and stored server-side for reporting. No
 * third party, no cookies beyond first-party storage.
 */
import { isInternalReferrerHost } from './internalReferrer';
import { CLICK_ID_PARAMS, adNetworkOnUrl, untaggedArrivalHost } from '@goldplus/shared/src/attribution/arrival';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
const FIRST = 'gp_attr_first';
const LAST = 'gp_attr_last';

function externalReferrer(): string {
  try {
    const r = document.referrer || '';
    if (!r) return '';
    const host = new URL(r).host;
    // The payment gateway returning the shopper, or our own subdomain, is not
    // a new arrival: it must not replace the real last touch.
    return host && !isInternalReferrerHost(host, location.host) ? r.slice(0, 500) : '';
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

/**
 * The ad network a click id on this URL belongs to (2026-10-17). A Google ad click arrives with a gclid and no
 * utm tags, from google.com or youtube.com: without this the last touch read it as organic search or organic
 * social. Our server's channel report already went by the click id; the order's own source/medium now agree.
 */
function paidNetworkOnUrl(p: URLSearchParams): string {
  // Ad click ids (the rulebook's AD_CLICK_IDS). Facebook's fbclid is not one: it is added to shares too, and names
  // Facebook as referrer instead (untaggedArrivalHost below).
  return adNetworkOnUrl(p);
}

export function captureAttribution(): void {
  try {
    const utm = readUtm();
    const paid = paidNetworkOnUrl(new URLSearchParams(location.search));
    const hasUtm = Object.keys(utm).length > 0 || !!paid;
    let ref = externalReferrer();
    // No referrer and no campaign, but opened in a social app's own browser, or carrying a social network's click id:
    // a visit from that network (the app it was opened in first; Instagram links carry fbclid too).
    if (!ref && !hasUtm) {
      const h = untaggedArrivalHost(new URLSearchParams(location.search), navigator.userAgent || '');
      if (h) ref = `https://${h}/`;
    }
    const now = new Date().toISOString();
    const touch = { ...utm, ...(paid ? { paid } : {}), referrer: ref, landingPath: location.pathname.slice(0, 300), at: now };

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
    // Whole domain labels only: a bare substring test made "t.co" match
    // snapchat.com, reddit.com and chatgpt.com, crediting their orders to X.
    const is = (re: RegExp) => re.test(host);
    // AI assistants keep their own host (the server files host + referral as
    // ai_assistant); gemini.google.com must not read as Google search.
    if (is(/(^|\.)(chatgpt\.com|chat\.openai\.com|gemini\.google\.com|bard\.google\.com|perplexity\.ai|copilot\.microsoft\.com|claude\.ai|meta\.ai|chat\.deepseek\.com)$/)) return host;
    if (is(/(^|\.)google\.[a-z.]+$/)) return 'google';
    if (is(/(^|\.)bing\.com$/)) return 'bing';
    if (is(/(^|\.)(duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|yandex\.[a-z.]+)$/)) return host.split('.').slice(-2, -1)[0];
    if (is(/(^|\.)(facebook\.com|fb\.com|fb\.me)$/)) return 'facebook';
    if (is(/(^|\.)instagram\.com$/)) return 'instagram';
    if (is(/(^|\.)(t\.co|x\.com|twitter\.com)$/)) return 'x';
    if (is(/(^|\.)tiktok\.com$/)) return 'tiktok';
    if (is(/(^|\.)snapchat\.com$/)) return 'snapchat';
    if (is(/(^|\.)(youtube\.com|youtu\.be)$/)) return 'youtube';
    if (is(/(^|\.)(pinterest\.[a-z.]+|pin\.it)$/)) return 'pinterest';
    if (is(/(^|\.)(linkedin\.com|lnkd\.in)$/)) return 'linkedin';
    if (is(/(^|\.)(wa\.me|whatsapp\.com)$/)) return 'whatsapp';
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

/** The rulebook's click ids, less fbclid: Meta's click is stored as the fbc built from it (recordAdClick). */
const CLICK_KEYS = CLICK_ID_PARAMS.filter((k) => k !== 'fbclid');
/** What the record holds: the URL parameters above, plus Meta's click id built from `fbclid`. */
const STORED_CLICK_KEYS = [...CLICK_KEYS, 'fbc'];
/**
 * What Google puts on an ad's landing URL besides the click id: the campaign (auto-tagging's gad_campaignid), the
 * kind of placement (gad_source), and the ValueTrack {network} the owner's final URL suffix adds as gp_net (g/s
 * Search, d Display, ytv/yts/vp YouTube, x Performance Max). Kept only with a Google click; never a click id.
 */
const GOOGLE_CAMPAIGN_KEYS = ['gad_campaignid', 'gad_source', 'gp_net'];
const CLICK_STORE = '_gp_ad_click';
const CLICK_WINDOW_MS = 30 * 864e5;
/** Google credits a sale up to 90 days after the click (the conversion action's click-through window). */
const GOOGLE_CLICK_WINDOW_MS = 90 * 864e5;
const isGoogleClick = (ids: Record<string, unknown> | undefined) => !!ids && ['gclid', 'gbraid', 'wbraid'].some((k) => typeof ids[k] === 'string');

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
    // Meta: the shop runs no Pixel, so nothing else records Meta's click. The
    // click id is built here, in Meta's format (fb.1.<first observed, ms>.<fbclid>),
    // from the fbclid on the landing URL — used exactly as received (it is case
    // sensitive). A reload of the same landing URL keeps the first time.
    const fbclid = p.get('fbclid');
    if (fbclid && /^[A-Za-z0-9_-]{8,500}$/.test(fbclid)) {
      let prior = '';
      try { prior = String(JSON.parse(localStorage.getItem(CLICK_STORE) || '{}')?.ids?.fbc ?? ''); } catch { /* unreadable: treat as a new click */ }
      ids.fbc = prior.endsWith(`.${fbclid}`) ? prior : `fb.1.${Date.now()}.${fbclid}`;
    }
    if (Object.keys(ids).length === 0) return;
    if (isGoogleClick(ids)) for (const k of GOOGLE_CAMPAIGN_KEYS) { const v = p.get(k); if (v && /^[A-Za-z0-9_-]{1,40}$/.test(v)) ids[k] = v; }
    localStorage.setItem(CLICK_STORE, JSON.stringify({ ids, src: (p.get('utm_source') || '').toLowerCase().slice(0, 60), at: Date.now() }));
  } catch { /* storage unavailable */ }
}

function recentClickIds(withCampaign = true): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(CLICK_STORE) || '{}');
    if (!raw.at || Date.now() - Number(raw.at) > (isGoogleClick(raw.ids) ? GOOGLE_CLICK_WINDOW_MS : CLICK_WINDOW_MS)) return {};
    const out: Record<string, string> = {};
    for (const k of STORED_CLICK_KEYS) if (typeof raw.ids?.[k] === 'string') out[k] = raw.ids[k];
    if (withCampaign && isGoogleClick(raw.ids)) for (const k of GOOGLE_CAMPAIGN_KEYS) if (typeof raw.ids?.[k] === 'string') out[k] = raw.ids[k];
    if (Object.keys(out).length && raw.src) out.src = String(raw.src);
    return out;
  } catch {
    return {};
  }
}

/**
 * The ad click this browser arrived on within the last 30 days, by click id
 * only (no utm_source): what the identity graph needs so that a product view
 * or basket add on a LATER page can still be tied to the ad. Without this the
 * stitch saw only the current URL, and a visitor who landed on the homepage
 * from an X ad reached the product page with no click id to report.
 */
export function recentAdClickIds(): Record<string, string> {
  const { src: _src, ...ids } = recentClickIds(false);
  return ids;
}

export function getCheckoutAttribution(): CheckoutAttribution | null {
  try {
    const last = JSON.parse(localStorage.getItem(LAST) || '{}');
    const first = JSON.parse(localStorage.getItem(FIRST) || '{}');
    const refSource = last.referrer ? sourceFromReferrer(last.referrer) : '';
    // A paid click without utm tags: the network that was paid (a Google ad watched on YouTube is youtube / cpc).
    const paidSource = last.paid === 'google' && refSource === 'youtube' ? 'youtube' : last.paid || '';
    const source = last.utm_source || paidSource || refSource || null;
    // A referral from a social network is organic social and one from a search
    // engine is organic search (the answers the landing-touch classifier gives),
    // not a generic referral.
    const medium = last.utm_medium || (last.paid && !last.utm_source ? (/^(google|microsoft)$/.test(last.paid) ? 'cpc' : 'paid_social') : null) || (last.utm_source ? 'campaign' : last.referrer ? (/^(facebook|instagram|x|tiktok|youtube|snapchat|pinterest|linkedin)$/.test(refSource) ? 'social' : /^(google|bing|duckduckgo|yahoo|ecosia|brave|yandex)$/.test(refSource) ? 'organic' : 'referral') : null) || null;
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
