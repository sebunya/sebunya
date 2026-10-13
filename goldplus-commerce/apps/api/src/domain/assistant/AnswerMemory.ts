/**
 * Goldie's answer memory (0179). Pure rules, no I/O.
 *
 * Most paid questions are not new: "which charger for an iPhone 13", "best
 * power bank for travel". The first time, the model answers; after that the
 * same answer is reused at no cost, but only while the facts in it still hold:
 * every product it names is re-read live and must still be in stock at the
 * same price, or the model is asked again. Answers the team pins never expire;
 * others expire after a week; two poor ratings retire an answer for good.
 */

export interface RememberedProduct { slug: string; price_ugx: number | null; availability: string }

export const MEMORY_TTL_DAYS = 7;
export const RETIRE_AFTER_POOR_RATINGS = 2;

export interface MemoryEntryState { pinned: boolean; retired: boolean; poorRatings: number; expiresAt: Date | null }

/** May this entry be served now? (The live product check comes after.) */
export function memoryUsable(e: MemoryEntryState, now: Date): boolean {
  if (e.retired) return false;
  if (!e.pinned && e.poorRatings >= RETIRE_AFTER_POOR_RATINGS) return false;
  if (!e.pinned && e.expiresAt && e.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

const SELLABLE = new Set(['in_stock', 'low_stock']);

/**
 * The facts in a remembered answer still hold when every product it named is still sellable at the same
 * price. Anything else (gone, out of stock, a new price) and the answer is stale: ask the model again.
 */
export function factsStillHold(remembered: RememberedProduct[], live: Array<RememberedProduct | null>): boolean {
  if (remembered.length !== live.length) return false;
  return remembered.every((r, i) => {
    const l = live[i];
    return !!l && l.slug === r.slug && l.price_ugx === r.price_ugx && SELLABLE.has(l.availability) === SELLABLE.has(r.availability) && SELLABLE.has(l.availability);
  });
}

/** Whether an answer is safe to remember: general, impersonal, and short enough to be one answer. */
export function rememberable(answer: string): boolean {
  const a = answer.trim();
  if (a.length < 20 || a.length > 1200) return false;
  // Anything that reads as personal or as a one-off action is not a general answer.
  if (/\b(welcome back|your order|your points|GP-[A-Z0-9]|booked|logged|alerted|passed (this|it) to the team|I have (asked|sent|filed))\b/i.test(a)) return false;
  if (/(?:\+?256|0)\s?7\d{2}[\s-]?\d{3}[\s-]?\d{3}|[\w.+-]+@[\w-]+\.[\w.-]+/.test(a)) return false;
  return true;
}
