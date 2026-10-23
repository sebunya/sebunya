/**
 * Our own links, tagged with where they were tapped (2026-10-23 audit: 94.6% of GA4 users "Direct"). A link in an
 * SMS, a WhatsApp message, an email or a Goldie reply arrives with no referrer (messaging apps send none), so GA4
 * could only call it Direct. Each shop link we send now carries `ch=<channel>.<campaign>`, which the page turns into
 * utm_source / utm_medium / utm_campaign before the tag reads the URL (BaseLayout). Short on purpose: an SMS is paid
 * by the character.
 *
 * Channels (the rulebook's CHANNEL_TAGS): s SMS, w WhatsApp, e email, m Messenger, i Instagram, a the installed app,
 * q print (a QR code).
 * Not tagged: links to the admin (staff), and a link that already says where it came from (ch= or utm_).
 */
export type ShopLinkChannel = 's' | 'w' | 'e' | 'm' | 'i' | 'a' | 'q';

const SHOP_URL = /https?:\/\/(?:www\.)?shopgoldplus\.com(?:\/[^\s"'<>]*)?/g;

/** The campaign a link is for, read from where it goes: short, stable, and the same for every channel. */
export function shopLinkCampaign(pathname: string): string {
  const p = pathname.toLowerCase();
  if (p.startsWith('/track-order')) return 'track';
  if (p.startsWith('/review')) return 'review';
  if (p.startsWith('/gift-card')) return 'gift';
  if (p.startsWith('/account/loyalty') || p.startsWith('/account/rewards')) return 'loyalty';
  if (p.startsWith('/reset-password')) return 'reset';
  if (p.startsWith('/checkout')) return 'pay';
  if (p.startsWith('/products/')) return 'product';
  if (p.startsWith('/shop')) return 'shop';
  return 'link';
}

export function tagShopUrl(url: string, channel: ShopLinkChannel, campaign?: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (!/(^|\.)shopgoldplus\.com$/.test(u.hostname) || u.pathname.startsWith('/admin')) return url;
  if (u.searchParams.has('ch') || [...u.searchParams.keys()].some((k) => k.startsWith('utm_'))) return url;
  const c = (campaign ?? shopLinkCampaign(u.pathname)).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'link';
  // Appended by hand, not via URLSearchParams.set: that would re-encode the existing query (a reference, a token).
  const hash = url.indexOf('#');
  const head = hash >= 0 ? url.slice(0, hash) : url;
  const frag = hash >= 0 ? url.slice(hash) : '';
  const bare = head === `${u.origin}` ? `${head}/` : head;
  return `${bare}${bare.includes('?') ? '&' : '?'}ch=${channel}.${c}${frag}`;
}

/** Every shop link inside a message, tagged. Sentence punctuation after a link stays outside it. */
export function tagShopLinks(text: string, channel: ShopLinkChannel, campaign?: string): string {
  if (!text) return text;
  return text.replace(SHOP_URL, (m) => {
    const trail = /[.,;:!?)\]]+$/.exec(m)?.[0] ?? '';
    const url = trail ? m.slice(0, -trail.length) : m;
    return tagShopUrl(url, channel, campaign) + trail;
  });
}

const GSM7 = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;
const GSM7_EXT = /[\^{}\\[~\]|€]/g;

/** How many SMS parts a text is billed as: GSM-7 (160, then 153 per part; ^{}\[~]|€ count twice) or UCS-2 (70, then 67). */
export function smsSegments(text: string): number {
  if (GSM7.test(text)) {
    const units = text.length + (text.match(GSM7_EXT)?.length ?? 0);
    return units <= 160 ? 1 : Math.ceil(units / 153);
  }
  const units = [...text].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  return units <= 70 ? 1 : Math.ceil(units / 67);
}

/** An SMS with its shop links tagged, unless the tag would make it cost one more part: then as it was. */
export function tagShopLinksInSms(text: string): string {
  const tagged = tagShopLinks(text, 's');
  return smsSegments(tagged) > smsSegments(text) ? text : tagged;
}
