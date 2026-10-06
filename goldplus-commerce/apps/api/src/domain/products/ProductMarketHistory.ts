/**
 * Facts about a product's market history, from product_market_events (0169).
 * Pure. The ad rotation planner trusts these to make claims in public
 * ("Price drop", "Back in stock", "New in"), so every function returns null
 * when the history cannot prove the fact, and never guesses.
 */

export interface MarketEvent {
  at: Date;
  priceUgx: number;
  stockStatus: string;
  published: boolean;
  /** CREATED, BASELINE, PRICE, STOCK, PUBLISHED */
  changed: string[];
}

const DAY = 86_400_000;
const IN_STOCK = (s: string) => s === 'in_stock' || s === 'low_stock';

const sorted = (events: MarketEvent[]) => [...events].sort((a, b) => a.at.getTime() - b.at.getTime());

/**
 * The lowest public price in the `windowDays` before the CURRENT price took
 * effect, or null when that cannot be proven:
 *  - no history, or the current price has no recorded start;
 *  - history starts after the window opens (a BASELINE row is the first thing
 *    known: nothing is claimed about the time before it).
 * The price in force when the window opened counts, as does every price set
 * inside the window.
 */
export function priorLowestPrice(events: MarketEvent[], windowDays = 30): number | null {
  const ev = sorted(events);
  if (!ev.length) return null;
  const current = ev[ev.length - 1].priceUgx;
  // When the current price took effect: the last event whose price differs from
  // the one before it, walking back while the price stays the same.
  let i = ev.length - 1;
  while (i > 0 && ev[i - 1].priceUgx === current) i--;
  if (i === 0) return null; // the current price is all we have ever seen
  const since = ev[i].at.getTime();
  const opens = since - windowDays * DAY;
  if (ev[0].at.getTime() > opens) return null; // history does not cover the whole window
  let inForce: number | null = null;
  let lowest = Infinity;
  for (let k = 0; k < i; k++) {
    const t = ev[k].at.getTime();
    if (t <= opens) inForce = ev[k].priceUgx; // the price standing when the window opened
    else lowest = Math.min(lowest, ev[k].priceUgx);
  }
  if (inForce !== null) lowest = Math.min(lowest, inForce);
  return Number.isFinite(lowest) ? lowest : null;
}

/** When the product last went from out of stock to in stock, or null. */
export function lastRestockedAt(events: MarketEvent[]): Date | null {
  const ev = sorted(events);
  for (let k = ev.length - 1; k > 0; k--) {
    if (IN_STOCK(ev[k].stockStatus) && ev[k - 1].stockStatus === 'out_of_stock') return ev[k].at;
  }
  return null;
}

/**
 * When the product was first published, from recorded history. A product
 * already published at the BASELINE has no recorded publish moment, so the
 * fallback is its creation time, which is when it was added to the shop.
 */
export function firstPublishedAt(events: MarketEvent[], createdAt: Date | null): Date | null {
  const ev = sorted(events);
  for (const e of ev) {
    if (!e.published) continue;
    if (e.changed.includes('BASELINE')) return createdAt;
    return e.at;
  }
  return null;
}
