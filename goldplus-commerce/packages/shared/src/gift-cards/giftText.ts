/**
 * The words a buyer puts on a gift card (0199, 0201): one set of rules for the API, which decides, and the storefront,
 * which says the same thing first, so a buyer on mobile data is not sent back by the server for something the page
 * could have told them.
 *
 * Pure and dependency-free: the storefront imports this file directly (not the package index), so nothing else from
 * the shared package reaches the browser bundle.
 */

/** The note on the card. The column is varchar(160); the form, the API and the share panel use this. */
export const GIFT_CARD_MESSAGE_MAX = 160;
/** The person's and the buyer's names. */
export const GIFT_CARD_NAME_MAX = 60;
/** The "From" line. */
export const GIFT_CARD_FROM_MAX = 40;

/**
 * The buyer's words go out under GoldPlus's name, so they must not be usable for a scam that borrows it: no links, no
 * web addresses and no phone or account numbers ("send 50,000 to 07…"). Names and kind words pass; anything that
 * reads like a place to send money or click does not.
 */
export function unsafeGiftText(value: string): boolean {
  if (/https?:|www\.|\.(com|ug|net|org|co|me|ly|io|link|xyz|info)\b/i.test(value)) return true;
  if (/\d[\d\s.-]{5,}\d/.test(value)) return true; // 7+ digits, spaced or not: a phone or account number
  if (/[<>{}\\]/.test(value)) return true;
  return false;
}

/**
 * At most `max` UTF-16 code units (the unit every length check here counts in), never ending on the first half of a
 * surrogate pair: an emoji is kept whole or left out, never cut into a broken character.
 */
export function clipText(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
