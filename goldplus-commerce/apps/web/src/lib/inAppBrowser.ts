/**
 * The in-app browser that opened the page, as a referrer host, when the page
 * carries no other evidence. Social apps open links in their own browser, which
 * names itself in the user agent and usually sends no referrer, so an organic
 * visit from a post, a story or a chat used to be filed as "direct". A paid
 * click still carries its click id and stays paid; a tagged link keeps its utm
 * values. Mirrored in BaseLayout's tag loader (for GA4), kept in step by a test.
 *
 * WhatsApp has no in-app browser marker: its links are tagged at the source
 * instead (shared/links/shopLinkTag) or arrive as Direct.
 */
const IN_APP: Array<[RegExp, string]> = [
  [/\bSnapchat\/\d/i, 'snapchat.com'],
  [/\bInstagram\s\d/i, 'instagram.com'],
  // Facebook and Messenger: FBAN/FBAV (iOS), FB_IAB (Android; Messenger is "Orca"/MESSENGER).
  [/\bFBAN\/|\bFBAV\/|\bFB_IAB\//, 'facebook.com'],
  [/\bmusical_ly|\bBytedanceWebview|\bTikTok\b/i, 'tiktok.com'],
  [/\bLinkedInApp\b/i, 'linkedin.com'],
  [/\bPinterest\/\d/i, 'pinterest.com'],
];

export function inAppReferrerHost(ua: string): string | null {
  for (const [re, host] of IN_APP) if (re.test(ua)) return host;
  return null;
}
