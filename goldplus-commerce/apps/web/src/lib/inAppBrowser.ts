/**
 * The in-app browser that opened the page, as a referrer host, when the page
 * carries no other evidence. Snapchat opens links from stories, Spotlight,
 * Public Profiles and chats in its own browser, which identifies itself as
 * "Snapchat/<version>" and usually sends no referrer, so an organic Snapchat
 * visit used to be filed as "direct". A paid Snapchat click still carries
 * ScCid and stays paid; a tagged link keeps its utm values.
 */
export function inAppReferrerHost(ua: string): string | null {
  return /\bSnapchat\/\d/i.test(ua) ? 'snapchat.com' : null;
}
