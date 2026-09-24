/**
 * Acquisition channel of a landing (dossier §8.1): paid click ids first, then
 * utm medium/source, then the referrer. Deterministic and pure; the same
 * inputs always give the same channel. "direct" means no evidence, not "no ad".
 */
export const CHANNELS = ['paid_search', 'paid_social', 'display', 'affiliate', 'email', 'sms', 'whatsapp', 'organic_search', 'organic_social', 'referral', 'direct', 'other_paid', 'other'] as const;
export type Channel = typeof CHANNELS[number];

/**
 * A referrer from the payment gateway (the shopper coming back after paying)
 * or from our own hosts is not an acquisition source. The storefront already
 * drops these (apps/web/src/lib/internalReferrer.ts); this is the server-side
 * safety net so an older page or another client cannot file them as referral.
 */
const PAYMENT_OR_SELF_HOST = /(^|\.)(pesapal\.com|shopgoldplus\.com)$/i;

const SEARCH = /(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu|ecosia|brave)\./i;
const SOCIAL = /(^|\.)(facebook|fb|instagram|tiktok|twitter|x|t|linkedin|lnkd|pinterest|snapchat|youtube|reddit|threads)\.(com|co|net|in|me)$/i;

export function classifyChannel(t: { source?: string | null; medium?: string | null; referrerHost?: string | null; clickIdTypes?: string[] }): Channel {
  const src = (t.source ?? '').toLowerCase().trim();
  const med = (t.medium ?? '').toLowerCase().trim();
  const clicks = new Set((t.clickIdTypes ?? []).map((c) => c.toLowerCase()));
  if (clicks.has('gclid') || clicks.has('gbraid') || clicks.has('wbraid') || clicks.has('msclkid')) return 'paid_search';
  if (clicks.has('fbclid') || clicks.has('ttclid') || clicks.has('twclid') || clicks.has('sccid') || clicks.has('li_fat_id') || clicks.has('epik')) return 'paid_social';
  if (/^(cpc|ppc|paid[_-]?search|sem)$/.test(med)) return 'paid_search';
  if (/^(paid[_-]?social|social[_-]?paid|paidsocial|cpm[_-]?social)$/.test(med)) return 'paid_social';
  if (/^(display|banner|cpm|programmatic|video|audio)$/.test(med)) return 'display';
  if (/^affiliate/.test(med)) return 'affiliate';
  if (/^e-?mail/.test(med)) return 'email';
  if (/^sms/.test(med)) return 'sms';
  if (src === 'whatsapp' || med === 'whatsapp') return 'whatsapp';
  if (/^(organic|seo)$/.test(med)) return 'organic_search';
  if (/^(social|social[_-]?organic)$/.test(med)) return 'organic_social';
  if (/^referral$/.test(med)) return 'referral';
  if (clicks.has('clickid') || clicks.has('click_id')) return 'other_paid';
  if (src || med) return 'other';
  const ref = (t.referrerHost ?? '').toLowerCase();
  if (!ref || PAYMENT_OR_SELF_HOST.test(ref)) return 'direct';
  if (SEARCH.test(ref)) return 'organic_search';
  if (SOCIAL.test(ref) || /(^|\.)(l\.facebook|lm\.facebook|m\.facebook)\.com$/.test(ref)) return 'organic_social';
  if (/(^|\.)(wa\.me|whatsapp\.com)$/.test(ref)) return 'whatsapp';
  return 'referral';
}
