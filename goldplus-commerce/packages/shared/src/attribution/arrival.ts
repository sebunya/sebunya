/**
 * Where a visit came from: the ONE rulebook (2026-10-23).
 *
 * Five places decide it: the tag loader in BaseLayout (what GA4 is told), lib/attribution (an order's source),
 * lib/telemetry (our landing touch), the API's Channels (the channel report) and the analytics address redaction.
 * Each kept its own copy of these lists, and every attribution bug found in the 2026-10-23 audit was one copy
 * drifting from another: fbclid filed as an ad, ScCid's capital letters, Pinterest missing, the payment host.
 * They now all read this module (the inline loader receives it as data, `loaderRules()`), and
 * tests/unit/AttributionContract.test.ts runs one table of real arrivals through every one of them.
 *
 * No imports: it is bundled into the storefront's own scripts.
 */

/** Click ids an ad network adds to its OWN ad clicks, and the network. Any of these proves an ad. */
export const AD_CLICK_IDS: Readonly<Record<string, { network: string; kind: 'search' | 'social' }>> = {
  gclid: { network: 'google', kind: 'search' },
  gbraid: { network: 'google', kind: 'search' },
  wbraid: { network: 'google', kind: 'search' },
  msclkid: { network: 'microsoft', kind: 'search' },
  ttclid: { network: 'tiktok', kind: 'social' },
  ScCid: { network: 'snapchat', kind: 'social' },
  li_fat_id: { network: 'linkedin', kind: 'social' },
  // X's and Pinterest's ids are documented as ad click ids; unlike fbclid there is no evidence of them on shares.
  twclid: { network: 'x', kind: 'social' },
  epik: { network: 'pinterest', kind: 'social' },
};

/**
 * A social network's own click id that is NOT proof of an ad: Facebook adds fbclid to every link clicked on Facebook,
 * Instagram and Messenger, a customer's share included. Proven on our own data: no ad had ever run, and 10 of 10
 * fbclid arrivals in 30 days were shares (2026-10-23). Untagged, it names the network as referrer. Only ids with such
 * evidence belong here; an id documented as an ad click id stays in AD_CLICK_IDS until shown otherwise.
 */
export const SOCIAL_SHARE_CLICK_IDS: Readonly<Record<string, string>> = { fbclid: 'facebook.com' };

/** Generic postback networks' click ids (Opera, Eagllwin, Boomplay): a paid click, network unknown. */
export const POSTBACK_CLICK_IDS = ['clickid', 'click_id'] as const;

/** Every click id the shop records, as it appears on the URL (case matters: ScCid). */
export const CLICK_ID_PARAMS: readonly string[] = [...Object.keys(AD_CLICK_IDS), ...Object.keys(SOCIAL_SHARE_CLICK_IDS), ...POSTBACK_CLICK_IDS];

/** URL parameters that say where a visit came from: carried onto the next page when the tag missed the landing. */
export const CAMPAIGN_PARAM = /^(utm_[a-z]+|gclid|gbraid|wbraid|dclid|fbclid|ttclid|twclid|msclkid|li_fat_id|sccid|epik)$/i;

/** Tags or an ad-only id: the visit's own evidence, which an in-app browser or a social click id never overrides. */
export const TAGGED_OR_AD_PARAM = /^(utm_.+|gclid|gbraid|wbraid|dclid|msclkid|ttclid|li_fat_id|sccid|twclid|epik|clickid|click_id)$/i;

/** Social apps' own browsers: no referrer, but they name themselves in the user agent. WhatsApp has no marker. */
export const IN_APP_BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bSnapchat\/\d/i, 'snapchat.com'],
  [/\bInstagram\s\d/i, 'instagram.com'],
  // Facebook and Messenger: FBAN/FBAV (iOS), FB_IAB (Android; Messenger is "Orca"/MESSENGER).
  [/\bFBAN\/|\bFBAV\/|\bFB_IAB\//, 'facebook.com'],
  [/\bmusical_ly|\bBytedanceWebview|\bTikTok\b/i, 'tiktok.com'],
  [/\bLinkedInApp\b/i, 'linkedin.com'],
  [/\bPinterest\/\d/i, 'pinterest.com'],
];

/** The payment gateway sending the shopper back: never an arrival (GA4's "unwanted referral"). */
export const PAYMENT_HOST = /(^|\.)pesapal\.com$/i;

export function inAppHost(ua: string): string | null {
  for (const [re, host] of IN_APP_BROWSERS) if (re.test(ua)) return host;
  return null;
}

/** A referrer host that is not an arrival from outside: the payment gateway, or this site and its subdomains. */
export function isInternalReferrerHost(host: string, selfHost: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  if (PAYMENT_HOST.test(h)) return true;
  const self = selfHost.toLowerCase().replace(/^www\./, '');
  return h === self || h.endsWith(`.${self}`);
}

/** The ad network an ad-only click id on this URL belongs to ('' when none). Google first: it may ride with others. */
export function adNetworkOnUrl(p: URLSearchParams): string {
  for (const k of Object.keys(AD_CLICK_IDS)) if (p.get(k)) return AD_CLICK_IDS[k].network;
  return '';
}

export function hasTagsOrAdId(p: URLSearchParams): boolean {
  for (const k of p.keys()) if (TAGGED_OR_AD_PARAM.test(k) && p.get(k)) return true;
  return false;
}

/**
 * The referrer host an UNTAGGED visit with no referrer is credited to: the social app it was opened in, else the
 * network whose own click id it carries (Instagram's links carry fbclid too: the app wins). Null when the visit has
 * tags or an ad-only id (its own evidence decides), or nothing names a network.
 */
export function untaggedArrivalHost(p: URLSearchParams, ua: string): string | null {
  if (hasTagsOrAdId(p)) return null;
  const app = inAppHost(ua);
  if (app) return app;
  for (const [k, host] of Object.entries(SOCIAL_SHARE_CLICK_IDS)) if (p.get(k)) return host;
  return null;
}

export interface LandingTouch {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  referrerHost: string | null;
  clickIdTypes: string[];
}

/** What a landing says about where the visitor came from, as our landing touch files it (pure: tested as a contract). */
export function landingTouch(input: { search: string; referrer: string; ua: string; selfHost: string }): LandingTouch {
  const q = new URLSearchParams(input.search);
  const clickIdTypes = CLICK_ID_PARAMS.filter((k) => q.get(k));
  let referrerHost: string | null = null;
  try {
    const h = input.referrer ? new URL(input.referrer).host : '';
    referrerHost = h && !isInternalReferrerHost(h, input.selfHost) ? h.slice(0, 253) : null;
  } catch { /* no referrer */ }
  if (!referrerHost) referrerHost = untaggedArrivalHost(q, input.ua);
  const clip = (v: string | null, n: number) => (v ? v.slice(0, n) : null);
  return { source: clip(q.get('utm_source'), 100), medium: clip(q.get('utm_medium'), 100), campaign: clip(q.get('utm_campaign'), 150), referrerHost, clickIdTypes };
}

/** The same rules as plain data, for the inline tag loader (BaseLayout `define:vars`), which cannot import modules. */
export function loaderRules(): { campaign: string; tagged: string; pay: string; iab: Array<[string, string, string]>; soc: Record<string, string> } {
  return {
    campaign: CAMPAIGN_PARAM.source,
    tagged: TAGGED_OR_AD_PARAM.source,
    pay: PAYMENT_HOST.source,
    iab: IN_APP_BROWSERS.map(([re, host]) => [re.source, re.flags, host]),
    soc: { ...SOCIAL_SHARE_CLICK_IDS },
  };
}
