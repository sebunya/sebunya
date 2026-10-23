/**
 * Acquisition channel of a landing (dossier §8.1): paid click ids first, then
 * utm medium/source, then the referrer. Deterministic and pure; the same
 * inputs always give the same channel. "direct" means no evidence, not "no ad".
 */
export const CHANNELS = ['paid_search', 'paid_social', 'display', 'affiliate', 'email', 'sms', 'whatsapp', 'organic_search', 'organic_social', 'ai_assistant', 'friend_referral', 'referral', 'direct', 'other_paid', 'other'] as const;
export type Channel = typeof CHANNELS[number];

/**
 * A referrer from the payment gateway (the shopper coming back after paying)
 * or from our own hosts is not an acquisition source. The storefront already
 * drops these (apps/web/src/lib/internalReferrer.ts); this is the server-side
 * safety net so an older page or another client cannot file them as referral.
 */
const PAYMENT_OR_SELF_HOST = /(^|\.)(pesapal\.com|shopgoldplus\.com)$/i;

/**
 * AI assistants that link shoppers to the store. ChatGPT tags its links with
 * utm_source=chatgpt.com; the others arrive by referrer only. Checked before
 * SEARCH, because gemini.google.com would otherwise read as Google search.
 */
const AI_ASSISTANT_HOST = /(^|\.)(chatgpt\.com|chat\.openai\.com|gemini\.google\.com|bard\.google\.com|perplexity\.ai|copilot\.microsoft\.com|claude\.ai|meta\.ai|chat\.deepseek\.com)$/i;
const AI_ASSISTANT_SOURCE = /^(chatgpt\.com|chat\.openai\.com|perplexity(\.ai)?|gemini\.google\.com|copilot\.microsoft\.com|claude\.ai)$/i;

const SEARCH = /(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu|ecosia|brave)\./i;
const SOCIAL = /(^|\.)(facebook|fb|instagram|tiktok|twitter|x|t|linkedin|lnkd|pinterest|snapchat|youtube|reddit|threads)\.(com|co|net|in|me)$/i;

/** utm_source values that name a social network: the bare name, or its domain. */
const SOCIAL_SOURCE = /^(x|twitter|t\.co|facebook|fb|instagram|ig|tiktok|linkedin|pinterest|snapchat|snap|youtube|threads|reddit)(\.com)?$/i;

export function classifyChannel(t: { source?: string | null; medium?: string | null; referrerHost?: string | null; clickIdTypes?: string[] }): Channel {
  const src = (t.source ?? '').toLowerCase().trim();
  const med = (t.medium ?? '').toLowerCase().trim();
  const clicks = new Set((t.clickIdTypes ?? []).map((c) => c.toLowerCase()));
  if (clicks.has('gclid') || clicks.has('gbraid') || clicks.has('wbraid') || clicks.has('msclkid')) return 'paid_search';
  // Only ids an ad network adds to its OWN ad clicks prove an ad. Facebook adds fbclid to every outbound link on
  // Facebook, Instagram and Messenger, a customer's share included (X's twclid and Pinterest's epik are not ad-only
  // either): with no ad ever run, 10 of 10 fbclid arrivals in 30 days were shares counted as paid (2026-10-23).
  // Those count as paid only when their tags say so (utm_medium below); untagged, they are organic social.
  if (clicks.has('ttclid') || clicks.has('sccid') || clicks.has('li_fat_id')) return 'paid_social';
  // A social network with a cost medium is a social ad (GA4's own Paid Social rule, same medium pattern), not search: Meta's {{site_source_name}}
  // gives fb, ig, msg (Messenger) and an (Audience Network).
  if (/^(.*cp.*|ppc|retargeting|paid.*)$/.test(med) && ((SOCIAL_SOURCE.test(src) && !/^youtube/.test(src)) || /^(meta|msg|messenger|an)$/.test(src))) return 'paid_social';
  if (/^(cpc|ppc|paid[_-]?search|sem)$/.test(med)) return 'paid_search';
  if (/^(paid[_-]?social|social[_-]?paid|paidsocial|cpm[_-]?social)$/.test(med)) return 'paid_social';
  if (/^(display|banner|cpm|programmatic|video|audio)$/.test(med)) return 'display';
  if (/^affiliate/.test(med)) return 'affiliate';
  if (/^e-?mail/.test(med)) return 'email';
  if (/^sms/.test(med)) return 'sms';
  // A customer's invite link (/r/<code>, 2026-10-22) tags its landing utm_medium=friend: the friend arrives from
  // WhatsApp or SMS with no referrer, which used to read as direct.
  if (med === 'friend') return 'friend_referral';
  if (src === 'whatsapp' || med === 'whatsapp') return 'whatsapp';
  // Our own tagged links (shared/links/shopLinkTag, 2026-10-23): Goldie's replies in Messenger and Instagram are a
  // conversation with our page (organic social); the installed app's start page is a returning customer (direct).
  if (med === 'chat' && /^(messenger|instagram)$/.test(src)) return 'organic_social';
  if (med === 'pwa') return 'direct';
  if (/^(organic|seo)$/.test(med)) return 'organic_search';
  if (/^(social|social[_-]?organic)$/.test(med)) return 'organic_social';
  // Assistants tag links with their own source and at most a referral medium.
  if ((!med || med === 'referral') && (AI_ASSISTANT_SOURCE.test(src) || AI_ASSISTANT_HOST.test(src))) return 'ai_assistant';
  if (/^referral$/.test(med)) return 'referral';
  if (clicks.has('clickid') || clicks.has('click_id')) return 'other_paid';
  // A link tagged with a social network as its source and no medium (the link
  // in an X or Instagram bio, a post) is that network's organic traffic. It
  // used to fall through to "other" and vanish from the social rows.
  if (!med && SOCIAL_SOURCE.test(src)) return 'organic_social';
  // A social network's own click id and no tags: a link shared or posted there (see the paid rule above).
  if (!src && !med && (clicks.has('fbclid') || clicks.has('twclid') || clicks.has('epik'))) return 'organic_social';
  if (src || med) return 'other';
  const ref = (t.referrerHost ?? '').toLowerCase();
  if (!ref || PAYMENT_OR_SELF_HOST.test(ref)) return 'direct';
  if (AI_ASSISTANT_HOST.test(ref)) return 'ai_assistant';
  if (SEARCH.test(ref)) return 'organic_search';
  if (SOCIAL.test(ref) || /(^|\.)(l\.facebook|lm\.facebook|m\.facebook)\.com$/.test(ref)) return 'organic_social';
  if (/(^|\.)(wa\.me|whatsapp\.com)$/.test(ref)) return 'whatsapp';
  return 'referral';
}
