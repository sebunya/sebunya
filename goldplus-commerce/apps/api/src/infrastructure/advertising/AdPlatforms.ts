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
export interface AdRequest { url: string; headers: Record<string, string>; body: unknown }
export interface AdPlatformDef {
  key: string;
  name: string;
  /** Non-secret ids the owner enters (shown in admin). */
  fields: Array<{ key: string; label: string; pattern: RegExp; hint: string }>;
  /** Label for the single write-only secret. */
  secretLabel: string;
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
  { key: 'google_ads', name: 'Google Ads (Search, Shopping, YouTube, PMax)', fields: [], secretLabel: '', events: {},
    unavailable: 'Sent through the Tag Manager server container (Google Ads conversion tag), not from here. Needs an active Google Ads account and its conversion ID + label.' },
  { key: 'microsoft_ads', name: 'Microsoft Advertising (Bing)', fields: [], secretLabel: '', events: {},
    unavailable: 'Needs a Microsoft Advertising account and UET tag ID; its server-side conversions API is added once the account exists.' },
  { key: 'x', name: 'X (Twitter) Ads', fields: [], secretLabel: '', events: {},
    unavailable: 'X Conversions API needs a developer app with OAuth 1.0a keys; added once the X Ads account and app exist.' },
  { key: 'spotify', name: 'Spotify Ads', fields: [], secretLabel: '', events: {},
    unavailable: 'Needs a Spotify Ad Analytics account; its conversions API credentials are issued per advertiser.' },
  { key: 'opera', name: 'Opera Ads', fields: [], secretLabel: '', events: {},
    unavailable: 'Opera Ads conversions are server-to-server postbacks configured per campaign by Opera; added with the first campaign.' },
  { key: 'transsion', name: 'Transsion (Eagllwin) / Boomplay', fields: [], secretLabel: '', events: {},
    unavailable: 'No public self-serve conversion API. Measured by campaign links (UTM), which order attribution already records.' },
  { key: 'sa360', name: 'Search Ads 360 / Campaign Manager 360', fields: [], secretLabel: '', events: {},
    unavailable: 'Enterprise products under a Google/agency contract; they read conversions from GA4 or CM360 Floodlight once contracted.' },
];

export const adPlatform = (key: string) => AD_PLATFORMS.find((p) => p.key === key) ?? null;
export const buildAdRequest = (key: string, e: CanonicalTelemetryEvent, cfg: Record<string, string>, secret: string): AdRequest | null => {
  const p = adPlatform(key);
  return p?.build ? p.build.call(p, e, cfg, secret) : null;
};
