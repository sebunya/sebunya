import { AD_CLICK_IDS, PAYMENT_HOST, SOCIAL_SHARE_CLICK_IDS } from '@goldplus/shared';
/**
 * Acquisition channel of a landing (dossier §8.1): paid click ids first, then
 * utm medium/source, then the referrer. Deterministic and pure; the same
 * inputs always give the same channel. "direct" means no evidence, not "no ad".
 */
export const CHANNELS = ['paid_search', 'paid_social', 'display', 'affiliate', 'email', 'sms', 'whatsapp', 'organic_search', 'organic_social', 'ai_assistant', 'friend_referral', 'print', 'youtube', 'offline_media', 'referral', 'direct', 'other_paid', 'other'] as const;
export type Channel = typeof CHANNELS[number];

/**
 * A referrer from the payment gateway (the shopper coming back after paying)
 * or from our own hosts is not an acquisition source. The storefront already
 * drops these (the rulebook's isInternalReferrerHost); this is the server-side
 * safety net so an older page or another client cannot file them as referral.
 */
const SELF_HOST = /(^|\.)shopgoldplus\.com$/i;

/**
 * AI assistants that link shoppers to the store. ChatGPT tags its links with
 * utm_source=chatgpt.com; the others arrive by referrer only. Checked before
 * SEARCH, because gemini.google.com would otherwise read as Google search.
 */
const AI_ASSISTANT_HOST = /(^|\.)(chatgpt\.com|chat\.openai\.com|gemini\.google\.com|bard\.google\.com|perplexity\.ai|copilot\.microsoft\.com|copilot\.cloud\.microsoft|claude\.ai|meta\.ai|chat\.deepseek\.com|grok\.com|chat\.mistral\.ai|poe\.com|you\.com|phind\.com|com\.openai\.chatgpt|ai\.perplexity\.app\.android)$/i;
const AI_ASSISTANT_SOURCE = /^(chatgpt\.com|chat\.openai\.com|perplexity(\.ai)?|gemini\.google\.com|copilot\.microsoft\.com|claude\.ai|grok\.com)$/i;

/**
 * A link clicked in an email: webmail (Gmail, Outlook, Yahoo, Proton) or a mail app opening the browser (Android
 * hands over the app's id as an android-app:// referrer, so its host is the package name). Checked before SEARCH:
 * mail.google.com and the Gmail app (com.google.android.gm) used to read as Google search, mail.yahoo.com as Yahoo
 * search, and Outlook fell through to "referral" (2026-10-29).
 */
const EMAIL_HOST = /(^|\.)(mail\.google\.com|inbox\.google\.com|com\.google\.android\.gm|mail\.yahoo\.com|com\.yahoo\.mobile\.client\.android\.mail|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|com\.microsoft\.office\.outlook|mail\.proton\.me|mail\.aol\.com|mail\.zoho\.com)$/i;

const SEARCH = /(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu|ecosia|brave)\./i;
/**
 * YouTube is its own channel (2026-10-24): the shop buys placements on YouTube channels (a dedicated video, an
 * integration, a mention) and pays the channel, not YouTube. A visit tagged utm_source=youtube (the link each
 * placement gets for the description) with no ad medium, or referred by youtube.com, is that channel, so the
 * model sees placement spend and placement traffic on the same row. A cost medium (cpc, paid social) is an ad.
 */
const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;
const YOUTUBE_SOURCE = /^(youtube|yt)(\.com)?$/i;
const SOCIAL = /(^|\.)(facebook|fb|instagram|tiktok|twitter|x|t|linkedin|lnkd|pinterest|snapchat|youtube|reddit|threads)\.(com|co|net|in|me)$/i;

/** utm_source values that name a social network: the bare name, or its domain. */
const SOCIAL_SOURCE = /^(x|twitter|t\.co|facebook|fb|instagram|ig|tiktok|linkedin|pinterest|snapchat|snap|youtube|threads|reddit)(\.com)?$/i;

const lower = (ks: string[]) => ks.map((k) => k.toLowerCase());
const AD_KIND_SEARCH = lower(Object.entries(AD_CLICK_IDS).filter(([, v]) => v.kind === 'search').map(([k]) => k));
const AD_KIND_SOCIAL = lower(Object.entries(AD_CLICK_IDS).filter(([, v]) => v.kind === 'social').map(([k]) => k));
const SOCIAL_SHARE_IDS = lower(Object.keys(SOCIAL_SHARE_CLICK_IDS));

export function classifyChannel(t: { source?: string | null; medium?: string | null; referrerHost?: string | null; clickIdTypes?: string[] }): Channel {
  const src = (t.source ?? '').toLowerCase().trim();
  const med = (t.medium ?? '').toLowerCase().trim();
  const clicks = new Set((t.clickIdTypes ?? []).map((c) => c.toLowerCase()));
  // Only ids an ad network adds to its OWN ad clicks prove an ad (the rulebook's AD_CLICK_IDS). Facebook adds fbclid
  // to every outbound link on Facebook, Instagram and Messenger, a customer's share included: with no ad ever run,
  // 10 of 10 fbclid arrivals in 30 days were shares counted as paid (2026-10-23). fbclid counts as paid only when
  // its tags say so; untagged, it is organic social (SOCIAL_SHARE_CLICK_IDS).
  if (AD_KIND_SEARCH.some((k) => clicks.has(k))) return 'paid_search';
  if (AD_KIND_SOCIAL.some((k) => clicks.has(k))) return 'paid_social';
  // A social network with a cost medium is a social ad (GA4's own Paid Social rule, same medium pattern), not search: Meta's {{site_source_name}}
  // gives fb, ig, msg (Messenger) and an (Audience Network).
  if (/^(.*cp.*|ppc|retargeting|paid.*)$/.test(med) && ((SOCIAL_SOURCE.test(src) && !/^youtube/.test(src)) || /^(meta|msg|messenger|an)$/.test(src))) return 'paid_social';
  if (/^(cpc|ppc|paid[_-]?search|sem)$/.test(med)) return 'paid_search';
  if (/^(paid[_-]?social|social[_-]?paid|paidsocial|cpm[_-]?social)$/.test(med)) return 'paid_social';
  // A sponsored video's description link (utm_medium=sponsorship) or any other non-ad YouTube tag is the YouTube
  // channels lever. A cost medium above means a real ad (YouTube ads are bought through Google Ads) and stays paid.
  if (YOUTUBE_SOURCE.test(src) && !/^(display|banner|cpm|programmatic)$/.test(med)) return 'youtube';
  // A bought slot on radio, TV, a podcast or a paper: its link is utm_source=<medium>&utm_medium=placement
  // (DrizzleMediaPlacementStore.placementLink). It fell through to "other", so the placement's scorecard showed no
  // arrivals while its cost sat on offline_media (2026-10-29).
  if (med === 'placement') return 'offline_media';
  if (/^(display|banner|cpm|programmatic|video|audio)$/.test(med)) return 'display';
  if (/^affiliate/.test(med)) return 'affiliate';
  if (/^e-?mail/.test(med)) return 'email';
  if (/^sms/.test(med)) return 'sms';
  // A customer's invite link (/r/<code>, 2026-10-22) tags its landing utm_medium=friend: the friend arrives from
  // WhatsApp or SMS with no referrer, which used to read as direct.
  if (med === 'friend') return 'friend_referral';
  // A QR code on a receipt, packaging, a flyer or the shop window (?ch=q.<campaign>: the rulebook's CHANNEL_TAGS).
  if (med === 'print') return 'print';
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
  if (!src && !med && SOCIAL_SHARE_IDS.some((k) => clicks.has(k))) return 'organic_social';
  if (src || med) return 'other';
  const ref = (t.referrerHost ?? '').toLowerCase();
  if (!ref || PAYMENT_HOST.test(ref) || SELF_HOST.test(ref)) return 'direct';
  if (AI_ASSISTANT_HOST.test(ref)) return 'ai_assistant';
  if (EMAIL_HOST.test(ref)) return 'email';
  if (SEARCH.test(ref)) return 'organic_search';
  if (YOUTUBE_HOST.test(ref)) return 'youtube';
  if (SOCIAL.test(ref) || /(^|\.)(l\.facebook|lm\.facebook|m\.facebook)\.com$/.test(ref)) return 'organic_social';
  if (/(^|\.)(wa\.me|whatsapp\.com)$/.test(ref)) return 'whatsapp';
  return 'referral';
}
