import crypto from 'crypto';
import type { CanonicalTelemetryEvent } from '@goldplus/shared';

/**
 * Server-side conversion APIs, one pure builder per platform: a canonical event
 * plus the platform's ids and token in, the exact HTTP request out (or null
 * when the platform has no equivalent event or lacks a required identifier).
 * No network here; AdConversionDispatch sends.
 *
 * Only platforms whose public server APIs are implemented are LIVE-capable.
 * The rest are listed with the honest reason they are not (never simulated).
 */

export type AdEventName = 'view_item' | 'add_to_cart' | 'begin_checkout' | 'add_payment_info' | 'purchase';
export interface AdRequest { url: string; headers: Record<string, string>; body?: unknown; method?: 'POST' | 'GET' }
export interface AdPlatformDef {
  key: string;
  name: string;
  /** Non-secret ids the owner enters (shown in admin). */
  fields: Array<{ key: string; label: string; pattern: RegExp; hint: string; optional?: boolean }>;
  /** Label for the single write-only secret ('' = the platform needs none). */
  secretLabel: string;
  /** Secret format hint shown in admin (e.g. a JSON bundle). */
  secretHint?: string;
  /** Per-send auth headers derived from the secret (OAuth exchange / request signing). */
  authorize?: (req: AdRequest, cfg: Record<string, string>, secret: string) => Promise<Record<string, string>>;
  /** A 2xx reply can still carry a failure (Google Ads partial failure): return it. */
  replyError?: (json: unknown) => string | null;
  events: Partial<Record<AdEventName, string>>;
  build?: (e: CanonicalTelemetryEvent, cfg: Record<string, string>, secret: string) => AdRequest | null;
  /** When not implementable yet: why (shown as-is in admin). */
  unavailable?: string;
}

/**
 * API versions. Meta supports a Graph version ~2 years (v23.0: May 2025).
 * LinkedIn sunsets a monthly version ~12 months after release, so the header
 * is derived: two months back from today is released and well inside support.
 */
export const META_GRAPH_VERSION = 'v23.0';
export function linkedInVersion(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
/** Lower-cased trimmed email, hashed. */
export const hashEmail = (email?: string | null) => (email && email.includes('@') ? sha(email.trim().toLowerCase()) : undefined);
/** Ugandan numbers to E.164 digits (07XXXXXXXX -> 2567XXXXXXXX), hashed. */
export function normalisePhoneUg(phone?: string | null): string | undefined {
  const d = String(phone ?? '').replace(/\D/g, '').replace(/^00/, '');
  if (/^0\d{9}$/.test(d)) return `256${d.slice(1)}`;
  if (/^256\d{9}$/.test(d)) return d;
  if (/^7\d{8}$/.test(d)) return `256${d}`;
  return d.length >= 10 && d.length <= 15 ? d : undefined;
}
export const hashPhone = (phone?: string | null) => { const n = normalisePhoneUg(phone); return n ? sha(n) : undefined; };
/** TikTok hashes E.164 WITH the leading '+' (Meta/Pinterest/Snapchat want digits only). */
export const hashPhonePlus = (phone?: string | null) => { const n = normalisePhoneUg(phone); return n ? sha(`+${n}`) : undefined; };

const items = (e: CanonicalTelemetryEvent) => e.ecommerce?.items ?? [];
const value = (e: CanonicalTelemetryEvent) => e.ecommerce?.value ?? items(e).reduce((s, i) => s + (i.price ?? 0) * (i.quantity ?? 1), 0);
const ids = (e: CanonicalTelemetryEvent) => items(e).map((i) => i.item_id);
const u = (e: CanonicalTelemetryEvent) => e.user_data ?? {};
const extId = (e: CanonicalTelemetryEvent) => (u(e).fp_client_id ? sha(u(e).fp_client_id as string) : undefined);

/** Parses a JSON secret bundle; throws a message that names the missing keys (never their values). */
export function parseJsonSecret(secret: string, keys: string[]): Record<string, string> {
  let o: Record<string, unknown>;
  try { o = JSON.parse(secret); } catch { throw new Error('credentials are not valid JSON'); }
  const missing = keys.filter((k) => typeof o[k] !== 'string' || !(o[k] as string).trim());
  if (missing.length) throw new Error(`credentials missing: ${missing.join(', ')}`);
  return o as Record<string, string>;
}

const tokenCache = new Map<string, { token: string; until: number }>();
/** OAuth2 refresh-token exchange (Google), cached until shortly before expiry. */
async function googleAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const key = sha(`${clientId}:${refreshToken}`);
  const hit = tokenCache.get(key);
  if (hit && hit.until > Date.now()) return hit.token;
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }), signal: AbortSignal.timeout(10_000) });
  const j = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string } | null;
  if (!res.ok || !j?.access_token) throw Object.assign(new Error(`Google OAuth refused: ${j?.error ?? res.status}`), { status: res.status });
  tokenCache.set(key, { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 300) * 1000 });
  return j.access_token;
}

const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
/** OAuth 1.0a HMAC-SHA1 header (X Ads API). A JSON body is not part of the signature. */
export function oauth1Header(method: string, url: string, c: Record<string, string>, nonce = crypto.randomBytes(16).toString('hex'), ts = Math.floor(Date.now() / 1000).toString()): string {
  const u2 = new URL(url);
  const oauth: Record<string, string> = { oauth_consumer_key: c.consumerKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: ts, oauth_token: c.accessToken, oauth_version: '1.0' };
  const params = [...Object.entries(oauth), ...[...u2.searchParams.entries()]].map(([k, v]) => [pct(k), pct(v)]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1));
  const base = [method.toUpperCase(), pct(`${u2.origin}${u2.pathname}`), pct(params.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const signature = crypto.createHmac('sha1', `${pct(c.consumerSecret)}&${pct(c.accessTokenSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ');
}

/** A network postback URL the OWNER entered: https, a real host name, never an address or internal name. */
export function safePostbackUrl(raw: string): URL | null {
  try {
    const x = new URL(raw);
    if (x.protocol !== 'https:' || x.username || x.password || x.port) return null;
    if (/^[\d.]+$/.test(x.hostname) || x.hostname.includes(':') || !x.hostname.includes('.') || /(^|\.)(local|internal|localhost)$/i.test(x.hostname)) return null;
    return x;
  } catch { return null; }
}

/**
 * Generic server-to-server postback (Opera, Eagllwin, Boomplay, any network):
 * the network's own URL with macros, called for a purchase that came from that
 * network's link (its click id in the URL parameter the owner names).
 * Macros: {click_id} {value} {currency} {order_id} {event_id}.
 */
function postback(key: string, name: string, where: string): AdPlatformDef {
  return {
    key, name, secretLabel: '', events: { purchase: 'postback' },
    fields: [
      { key: 'postbackUrl', label: 'Postback URL (with {click_id})', pattern: /^https:\/\/[^\s]+\{click_id\}[^\s]*$/, hint: `From ${where}. Macros: {click_id} {value} {currency} {order_id} {event_id}` },
      { key: 'clickParam', label: 'Click-id URL parameter', pattern: /^(clickid|click_id)$/, hint: 'The parameter the network adds to your links: clickid or click_id' },
    ],
    build(e, cfg) {
      const ud = u(e);
      if (e.event_name !== 'purchase' || !ud.network_click_id || ud.network_click_param !== cfg.clickParam) return null;
      const filled = cfg.postbackUrl
        .replace(/\{click_id\}/g, encodeURIComponent(ud.network_click_id))
        .replace(/\{value\}/g, encodeURIComponent(String(value(e))))
        .replace(/\{currency\}/g, encodeURIComponent(e.ecommerce?.currency ?? 'UGX'))
        .replace(/\{order_id\}/g, encodeURIComponent(e.ecommerce?.transaction_id ?? ''))
        .replace(/\{event_id\}/g, encodeURIComponent(e.event_id));
      const url = safePostbackUrl(filled);
      return url ? { url: url.toString(), headers: {}, method: 'GET' } : null;
    },
  };
}

export const AD_PLATFORMS: AdPlatformDef[] = [
  {
    key: 'meta', name: 'Meta (Facebook, Instagram, WhatsApp ads)',
    fields: [{ key: 'datasetId', label: 'Dataset (pixel) ID', pattern: /^\d{10,20}$/, hint: 'Events Manager > Datasets' }],
    secretLabel: 'Conversions API access token',
    events: { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', add_payment_info: 'AddPaymentInfo', purchase: 'Purchase' },
    build(e, cfg, token) {
      const name = this.events[e.event_name as AdEventName]; if (!name) return null;
      const ud = u(e);
      return {
        url: `https://graph.facebook.com/${META_GRAPH_VERSION}/${cfg.datasetId}/events?access_token=${encodeURIComponent(token)}`,
        headers: { 'content-type': 'application/json' },
        body: { data: [{
          event_name: name, event_time: e.event_time, event_id: e.event_id, action_source: 'website',
          event_source_url: e.page_location,
          user_data: { em: ud.hashed_email ? [ud.hashed_email] : undefined, ph: ud.hashed_phone ? [ud.hashed_phone] : undefined,
            external_id: extId(e) ? [extId(e)] : undefined, client_ip_address: ud.ip_address, client_user_agent: ud.user_agent, fbc: ud.fbc, fbp: ud.fbp },
          custom_data: { currency: e.ecommerce?.currency ?? 'UGX', value: value(e), content_ids: ids(e), content_type: 'product',
            contents: items(e).map((i) => ({ id: i.item_id, quantity: i.quantity ?? 1, item_price: i.price })), order_id: e.ecommerce?.transaction_id },
        }] },
      };
    },
  },
  {
    key: 'tiktok', name: 'TikTok',
    fields: [{ key: 'pixelCode', label: 'Pixel code', pattern: /^[A-Z0-9]{10,30}$/, hint: 'TikTok Events Manager > Web events' }],
    secretLabel: 'Events API access token',
    events: { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', add_payment_info: 'AddPaymentInfo', purchase: 'CompletePayment' },
    build(e, cfg, token) {
      const name = this.events[e.event_name as AdEventName]; if (!name) return null;
      const ud = u(e);
      return {
        url: 'https://business-api.tiktok.com/open_api/v1.3/event/track/',
        headers: { 'content-type': 'application/json', 'Access-Token': token },
        body: { event_source: 'web', event_source_id: cfg.pixelCode, data: [{
          event: name, event_time: e.event_time, event_id: e.event_id,
          user: { email: ud.hashed_email, phone: ud.hashed_phone_plus, external_id: extId(e), ip: ud.ip_address, user_agent: ud.user_agent, ttclid: ud.ttclid },
          page: { url: e.page_location, referrer: e.page_referrer },
          properties: { currency: e.ecommerce?.currency ?? 'UGX', value: value(e), content_type: 'product', order_id: e.ecommerce?.transaction_id,
            contents: items(e).map((i) => ({ content_id: i.item_id, content_name: i.item_name, quantity: i.quantity ?? 1, price: i.price })) },
        }] },
      };
    },
  },
  {
    key: 'pinterest', name: 'Pinterest',
    fields: [{ key: 'adAccountId', label: 'Ad account ID', pattern: /^\d{6,20}$/, hint: 'Pinterest Ads > account settings' }],
    secretLabel: 'Conversions access token',
    events: { view_item: 'page_visit', add_to_cart: 'add_to_cart', purchase: 'checkout' },
    build(e, cfg, token) {
      const name = this.events[e.event_name as AdEventName]; if (!name) return null;
      const ud = u(e);
      return {
        url: `https://api.pinterest.com/v5/ad_accounts/${cfg.adAccountId}/events`,
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: { data: [{
          event_name: name, action_source: 'web', event_time: e.event_time, event_id: e.event_id, event_source_url: e.page_location,
          user_data: { em: ud.hashed_email ? [ud.hashed_email] : undefined, ph: ud.hashed_phone ? [ud.hashed_phone] : undefined,
            external_id: extId(e) ? [extId(e)] : undefined, client_ip_address: ud.ip_address, client_user_agent: ud.user_agent },
          custom_data: { currency: e.ecommerce?.currency ?? 'UGX', value: String(value(e)), content_ids: ids(e), num_items: items(e).reduce((s, i) => s + (i.quantity ?? 1), 0),
            order_id: e.ecommerce?.transaction_id, contents: items(e).map((i) => ({ id: i.item_id, item_price: i.price != null ? String(i.price) : undefined, quantity: i.quantity ?? 1 })) },
        }] },
      };
    },
  },
  {
    key: 'snapchat', name: 'Snapchat',
    fields: [{ key: 'pixelId', label: 'Pixel ID', pattern: /^[0-9a-f-]{36}$/i, hint: 'Snapchat Ads Manager > Events Manager' }],
    secretLabel: 'Conversions API token',
    events: { view_item: 'VIEW_CONTENT', add_to_cart: 'ADD_CART', begin_checkout: 'START_CHECKOUT', add_payment_info: 'ADD_BILLING', purchase: 'PURCHASE' },
    build(e, cfg, token) {
      const name = this.events[e.event_name as AdEventName]; if (!name) return null;
      const ud = u(e);
      return {
        url: `https://tr.snapchat.com/v3/${cfg.pixelId}/events?access_token=${encodeURIComponent(token)}`,
        headers: { 'content-type': 'application/json' },
        body: { data: [{
          event_name: name, event_time: e.event_time, event_id: e.event_id, action_source: 'website', event_source_url: e.page_location,
          user_data: { em: ud.hashed_email ? [ud.hashed_email] : undefined, ph: ud.hashed_phone ? [ud.hashed_phone] : undefined,
            external_id: extId(e) ? [extId(e)] : undefined, client_ip_address: ud.ip_address, client_user_agent: ud.user_agent },
          custom_data: { currency: e.ecommerce?.currency ?? 'UGX', value: value(e), content_ids: ids(e), order_id: e.ecommerce?.transaction_id, num_items: items(e).length },
        }] },
      };
    },
  },
  {
    key: 'linkedin', name: 'LinkedIn (business buyers)',
    fields: [{ key: 'conversionId', label: 'Conversion rule ID', pattern: /^\d{4,20}$/, hint: 'Campaign Manager > Conversions (Conversions API rule)' }],
    secretLabel: 'Conversions API access token',
    events: { purchase: 'purchase' },
    build(e, cfg, token) {
      // LinkedIn matches only on hashed email (or its own click id): no email, no request.
      const ud = u(e);
      if (e.event_name !== 'purchase' || !ud.hashed_email) return null;
      return {
        url: 'https://api.linkedin.com/rest/conversionEvents',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, 'LinkedIn-Version': linkedInVersion(), 'X-Restli-Protocol-Version': '2.0.0' },
        body: { conversion: `urn:lla:llaPartnerConversion:${cfg.conversionId}`, conversionHappenedAt: e.event_time * 1000, eventId: e.event_id,
          conversionValue: { currencyCode: e.ecommerce?.currency ?? 'UGX', amount: String(value(e)) },
          user: { userIds: [{ idType: 'SHA256_EMAIL', idValue: ud.hashed_email }] } },
      };
    },
  },
  {
    key: 'google_ads', name: 'Google Ads (Search, Shopping, YouTube, PMax)',
    fields: [
      { key: 'customerId', label: 'Customer ID (10 digits, no dashes)', pattern: /^\d{10}$/, hint: 'Google Ads, top right' },
      { key: 'conversionActionId', label: 'Conversion action ID', pattern: /^\d{4,20}$/, hint: 'Goals > Conversions > the purchase action (ctId in its URL)' },
      { key: 'loginCustomerId', label: 'Manager account ID (if used)', pattern: /^(\d{10})?$/, hint: 'Only when access goes through an MCC', optional: true },
      { key: 'apiVersion', label: 'Google Ads API version', pattern: /^v\d{2}$/, hint: 'e.g. v21 — Google sunsets versions yearly', optional: true },
    ],
    secretLabel: 'API credentials (JSON)',
    secretHint: '{"developerToken":"…","clientId":"….apps.googleusercontent.com","clientSecret":"…","refreshToken":"…"}',
    events: { purchase: 'uploadClickConversions' },
    async authorize(_req, _cfg, secret) {
      const c = parseJsonSecret(secret, ['developerToken', 'clientId', 'clientSecret', 'refreshToken']);
      const token = await googleAccessToken(c.clientId, c.clientSecret, c.refreshToken);
      return { Authorization: `Bearer ${token}`, 'developer-token': c.developerToken };
    },
    replyError: (j) => { const e = (j as { partialFailureError?: { message?: string } })?.partialFailureError; return e ? `partial failure: ${String(e.message ?? '').slice(0, 300)}` : null; },
    build(e, cfg) {
      if (e.event_name !== 'purchase') return null;
      const ud = u(e);
      // A click id, or the hashed email/phone for enhanced conversions; neither = nothing to match.
      const userIdentifiers = [ud.hashed_email ? { hashedEmail: ud.hashed_email } : null, ud.hashed_phone_plus ? { hashedPhoneNumber: ud.hashed_phone_plus } : null].filter(Boolean);
      if (!ud.gclid && !ud.gbraid && !ud.wbraid && userIdentifiers.length === 0) return null;
      const t = new Date(e.event_time * 1000).toISOString().replace('T', ' ').slice(0, 19) + '+00:00';
      const v = cfg.apiVersion || 'v21';
      return {
        url: `https://googleads.googleapis.com/${v}/customers/${cfg.customerId}:uploadClickConversions`,
        headers: { 'content-type': 'application/json', ...(cfg.loginCustomerId ? { 'login-customer-id': cfg.loginCustomerId } : {}) },
        body: { partialFailure: true, conversions: [{
          ...(ud.gclid ? { gclid: ud.gclid } : ud.gbraid ? { gbraid: ud.gbraid } : ud.wbraid ? { wbraid: ud.wbraid } : {}),
          conversionAction: `customers/${cfg.customerId}/conversionActions/${cfg.conversionActionId}`,
          conversionDateTime: t, conversionValue: value(e), currencyCode: e.ecommerce?.currency ?? 'UGX', orderId: e.ecommerce?.transaction_id,
          ...(userIdentifiers.length ? { userIdentifiers } : {}),
        }] },
      };
    },
  },
  {
    key: 'microsoft_ads', name: 'Microsoft Advertising (Bing)',
    fields: [{ key: 'tagId', label: 'UET tag ID', pattern: /^\d{6,12}$/, hint: 'Microsoft Advertising > Tools > UET tag' }],
    secretLabel: 'UET Conversions API token',
    events: { view_item: 'view_item', add_to_cart: 'add_to_cart', begin_checkout: 'begin_checkout', purchase: 'purchase' },
    build(e, cfg, token) {
      const name = this.events[e.event_name as AdEventName]; if (!name) return null;
      const ud = u(e);
      return {
        url: `https://capi.uet.microsoft.com/v1/${cfg.tagId}/events`,
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: { data: [{
          eventType: 'custom', eventName: name, eventId: e.event_id, eventTime: e.event_time, eventSourceUrl: e.page_location,
          userData: { em: ud.hashed_email, ph: ud.hashed_phone, clientIpAddress: ud.ip_address, clientUserAgent: ud.user_agent, msclkid: ud.msclkid, anonymousId: extId(e) },
          customData: { value: value(e), currency: e.ecommerce?.currency ?? 'UGX', transactionId: e.ecommerce?.transaction_id, itemIds: ids(e), pageType: e.event_name === 'purchase' ? 'purchase' : 'product' },
        }] },
      };
    },
  },
  {
    key: 'x', name: 'X (Twitter) Ads',
    fields: [
      { key: 'pixelId', label: 'Pixel ID', pattern: /^[a-z0-9]{4,10}$/, hint: 'X Ads > Events Manager' },
      { key: 'purchaseEventId', label: 'Purchase event ID (tw-…)', pattern: /^tw-[a-z0-9]+-[a-z0-9]+$/, hint: 'The purchase event you created in Events Manager' },
      { key: 'addToCartEventId', label: 'Add-to-cart event ID (tw-…)', pattern: /^(tw-[a-z0-9]+-[a-z0-9]+)?$/, hint: 'Optional', optional: true },
    ],
    secretLabel: 'API keys (JSON)',
    secretHint: '{"consumerKey":"…","consumerSecret":"…","accessToken":"…","accessTokenSecret":"…"}',
    events: { add_to_cart: 'add_to_cart', purchase: 'purchase' },
    async authorize(req, _cfg, secret) {
      const c = parseJsonSecret(secret, ['consumerKey', 'consumerSecret', 'accessToken', 'accessTokenSecret']);
      return { Authorization: oauth1Header(req.method ?? 'POST', req.url, c) };
    },
    build(e, cfg) {
      const eventId = e.event_name === 'purchase' ? cfg.purchaseEventId : e.event_name === 'add_to_cart' ? cfg.addToCartEventId : '';
      if (!eventId) return null;
      const ud = u(e);
      const identifiers = [ud.twclid ? { twclid: ud.twclid } : null, ud.hashed_email ? { hashed_email: ud.hashed_email } : null, ud.hashed_phone ? { hashed_phone_number: ud.hashed_phone } : null].filter(Boolean);
      if (identifiers.length === 0) return null;
      return {
        url: `https://ads-api.x.com/12/measurement/conversions/${cfg.pixelId}`,
        headers: { 'content-type': 'application/json' },
        body: { conversions: [{ conversion_time: new Date(e.event_time * 1000).toISOString(), event_id: eventId, identifiers,
          conversion_id: e.event_id, value: value(e), price_currency: e.ecommerce?.currency ?? 'UGX', number_items: items(e).reduce((s, i) => s + (i.quantity ?? 1), 0) }] },
      };
    },
  },
  postback('opera', 'Opera Ads (postback)', 'Opera Ads account manager / campaign tracking settings'),
  postback('transsion', 'Transsion Eagllwin (Tecno, Infinix, itel) (postback)', 'Eagllwin campaign tracking settings'),
  postback('boomplay', 'Boomplay Ads (postback)', 'Boomplay Ads campaign tracking settings'),
  postback('network', 'Any other ad network (postback)', 'The network\'s server-to-server postback settings'),
  { key: 'spotify', name: 'Spotify Ads', fields: [], secretLabel: '', events: {},
    unavailable: 'Spotify Ad Analytics issues its conversions API credentials to each advertiser under its own terms. If Spotify gives you a postback URL, use "Any other ad network (postback)".' },
  { key: 'sa360', name: 'Search Ads 360 / Campaign Manager 360', fields: [], secretLabel: '', events: {},
    unavailable: 'Enterprise products under a Google/agency contract; once contracted they read conversions from GA4 (already live) or Floodlight.' },
];

export const adPlatform = (key: string) => AD_PLATFORMS.find((p) => p.key === key) ?? null;
export const buildAdRequest = (key: string, e: CanonicalTelemetryEvent, cfg: Record<string, string>, secret: string): AdRequest | null => {
  const p = adPlatform(key);
  return p?.build ? p.build.call(p, e, cfg, secret) : null;
};
