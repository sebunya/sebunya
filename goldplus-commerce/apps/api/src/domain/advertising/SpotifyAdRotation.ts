/**
 * Spotify ad rotation planner (2026-10-06). Pure: no network, no clock of its
 * own, no ids it did not receive.
 *
 * Spotify offers no product-catalogue ads for a shop like this (its Ads API
 * `CATALOG` asset format is undocumented; "catalog" in its reference means its
 * catalogue of ad-product RULES). So "ads that change" are built here: from
 * the shop's real data, decide which products deserve a Spotify ad, what each
 * ad says, and when a running ad has become untrue or stale. The output is a
 * PLAN. A later adapter stages it as Spotify Ads API drafts; a person approves
 * before anything is published or spent.
 *
 * House rules this enforces (CLAUDE.md: no fake urgency, no fake scarcity, no
 * invented product facts):
 *  - a price in an ad is the current public price, always;
 *  - "Price drop" only when the current price is below the LOWEST price of the
 *    30 days before it took effect (the EU Omnibus test: a price raised and
 *    lowered again is not a drop);
 *  - "New in" only for products first published in the last 21 days, "Back in
 *    stock" only for a restock in the last 7 days;
 *  - never a stock count, a countdown or "only N left";
 *  - an ad for a product that cannot be bought (unpublished, out of stock, no
 *    image) is paused, even when that leaves no ad running.
 *
 * Spotify limits enforced (spotify/ads-agentic-tools, ads skill): tagline 2-40
 * characters; a live ad needs a click-through URL.
 */

export const TAGLINE_MAX = 40;
export const NEW_ARRIVAL_DAYS = 21;
export const RESTOCK_DAYS = 7;
export const MIN_RUN_DAYS_BEFORE_SWAP = 7;
const DAY = 86_400_000;

export interface RotationProduct {
  productId: string;
  name: string;
  /** Current public price, whole shillings. */
  priceUgx: number;
  /**
   * Lowest public price in the 30 days BEFORE the current price took effect;
   * null when there is no 30-day history. Never the dealer price or a floor.
   */
  priorLowestUgx30d: number | null;
  published: boolean;
  inStock: boolean;
  /** Absolute https URL of the product page. */
  url: string;
  /** Absolute https URL of a product photo usable as the ad image; null = none. */
  imageUrl: string | null;
  firstPublishedAt: Date | null;
  /** When it last went from out of stock to in stock; null = not recently. */
  restockedAt: Date | null;
  /** Paid orders of this product in the last 30 days, all channels. */
  orders30d: number;
}

export interface RotationAd {
  adId: string;
  productId: string;
  tagline: string;
  status: 'ACTIVE' | 'PAUSED';
  startedAt: Date;
}

export type RotationReason = 'PRICE_DROP' | 'BACK_IN_STOCK' | 'NEW_ARRIVAL' | 'BEST_SELLER';

export type RotationAction =
  | { kind: 'CREATE'; productId: string; tagline: string; clickthroughUrl: string; imageUrl: string; reason: RotationReason; why: string }
  | { kind: 'RESUME'; adId: string; productId: string; tagline: string; reason: RotationReason; why: string }
  | { kind: 'UPDATE_TAGLINE'; adId: string; productId: string; from: string; to: string; why: string }
  | { kind: 'PAUSE'; adId: string; productId: string; why: string };

export interface RotationPlan {
  actions: RotationAction[];
  /** Products that would qualify but are skipped, with the reason (shown to the owner). */
  skipped: Array<{ productId: string; why: string }>;
  /** True when no product can be advertised truthfully right now. */
  nothingToAdvertise: boolean;
}

export const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString('en-UG')}`;

/** A genuine price drop by the 30-day-lowest test, or null. */
export function isGenuinePriceDrop(p: Pick<RotationProduct, 'priceUgx' | 'priorLowestUgx30d'>): boolean {
  return p.priorLowestUgx30d != null && p.priorLowestUgx30d > 0 && p.priceUgx < p.priorLowestUgx30d;
}

/** Why a product deserves an ad today, strongest reason first; null = only a best seller, or nothing. */
export function rotationReason(p: RotationProduct, now: Date): RotationReason | null {
  if (isGenuinePriceDrop(p)) return 'PRICE_DROP';
  if (p.restockedAt && now.getTime() - p.restockedAt.getTime() <= RESTOCK_DAYS * DAY) return 'BACK_IN_STOCK';
  if (p.firstPublishedAt && now.getTime() - p.firstPublishedAt.getTime() <= NEW_ARRIVAL_DAYS * DAY) return 'NEW_ARRIVAL';
  if (p.orders30d > 0) return 'BEST_SELLER';
  return null;
}

/** Whether an ad for this product would be honest at all. Null = yes; otherwise why not. */
export function unadvertisable(p: RotationProduct | undefined): string | null {
  if (!p) return 'the product no longer exists in the shop';
  if (!p.published) return 'the product is not published';
  if (!p.inStock) return 'the product is out of stock';
  if (!p.imageUrl || !/^https:\/\//.test(p.imageUrl)) return 'the product has no usable photo';
  if (!/^https:\/\//.test(p.url)) return 'the product has no https page';
  if (!(p.priceUgx > 0)) return 'the product has no public price';
  return null;
}

/** Cut a name at a word boundary so `fits(name)` holds; never mid-word, never an ellipsis that hides a fact. */
function shortenName(name: string, fits: (n: string) => boolean): string | null {
  const words = name.trim().split(/\s+/);
  for (let n = words.length; n >= 1; n--) {
    const candidate = words.slice(0, n).join(' ');
    if (fits(candidate)) return candidate;
  }
  return null;
}

/**
 * The ad headline: at most 40 characters, the current price whenever it fits,
 * and the reason only when it is true. Deterministic, so a running ad whose
 * facts have not changed is never rewritten.
 */
export function taglineFor(p: RotationProduct, reason: RotationReason | null): string {
  const price = ugx(p.priceUgx);
  const lead = reason === 'PRICE_DROP' ? 'Price drop' : reason === 'BACK_IN_STOCK' ? 'Back in stock' : reason === 'NEW_ARRIVAL' ? 'New in' : null;
  const forms: Array<(n: string) => string> = [
    ...(lead ? [(n: string) => `${lead}: ${n}, ${price}`, (n: string) => `${lead}: ${n}`] : []),
    (n: string) => `${n}, ${price}`,
    (n: string) => n,
  ];
  // Prefer the richest form whose name keeps at least two words (or the whole
  // name, if it is one word): "New in: Samsung Galaxy, UGX 450,000" says more than
  // "New in: Samsung, UGX 450,000", which could be any Samsung.
  const minWords = Math.min(2, p.name.trim().split(/\s+/).length);
  for (const form of forms) {
    const name = shortenName(p.name, (n) => form(n).length <= TAGLINE_MAX);
    if (name && name.split(' ').length >= minWords) return form(name);
  }
  // Last resort: the name alone, cut at a word boundary (never mid-word).
  return shortenName(p.name, (n) => n.length <= TAGLINE_MAX) ?? p.name.slice(0, TAGLINE_MAX);
}

/** The product page with Spotify UTM tags, so the shop's own attribution can tell which ad sold. */
export function clickthroughUrl(p: Pick<RotationProduct, 'url' | 'productId'>): string {
  const u = new URL(p.url);
  u.searchParams.set('utm_source', 'spotify');
  u.searchParams.set('utm_medium', 'paid_audio');
  u.searchParams.set('utm_campaign', 'goldplus-rotation');
  u.searchParams.set('utm_content', p.productId);
  return u.toString();
}

const REASON_RANK: Record<RotationReason, number> = { PRICE_DROP: 4, BACK_IN_STOCK: 3, NEW_ARRIVAL: 2, BEST_SELLER: 1 };
const REASON_WHY: Record<RotationReason, string> = {
  PRICE_DROP: 'below its lowest price of the previous 30 days',
  BACK_IN_STOCK: `back in stock within the last ${RESTOCK_DAYS} days`,
  NEW_ARRIVAL: `first published within the last ${NEW_ARRIVAL_DAYS} days`,
  BEST_SELLER: 'sold in the last 30 days',
};

/**
 * Plan the next rotation.
 *  1. Every running ad is checked: unadvertisable → PAUSE; facts changed → UPDATE_TAGLINE.
 *  2. Free slots (up to `maxActive`) go to the strongest candidates: reason
 *     first, then Spotify-attributed orders, then all orders. A paused ad for
 *     the same product is RESUMED rather than duplicated.
 *  3. When every slot is full, the weakest ad that has run `MIN_RUN_DAYS_BEFORE_SWAP`
 *     days without a Spotify-attributed order is swapped for a candidate with a
 *     stronger reason. Never more than one swap per run: rotation, not churn.
 */
export function planSpotifyRotation(input: {
  products: RotationProduct[];
  ads: RotationAd[];
  /** Paid orders per product whose visit came from utm_source=spotify, last 30 days. */
  spotifyOrders30d: Record<string, number>;
  now: Date;
  maxActive?: number;
}): RotationPlan {
  const max = Math.max(1, Math.min(10, input.maxActive ?? 3));
  const byId = new Map(input.products.map((p) => [p.productId, p]));
  const actions: RotationAction[] = [];
  const skipped: RotationPlan['skipped'] = [];
  const sp = (id: string) => input.spotifyOrders30d[id] ?? 0;

  // 1. running ads
  const keep: RotationAd[] = [];
  for (const ad of input.ads.filter((a) => a.status === 'ACTIVE')) {
    const p = byId.get(ad.productId);
    const bad = unadvertisable(p);
    if (bad) { actions.push({ kind: 'PAUSE', adId: ad.adId, productId: ad.productId, why: `Paused: ${bad}.` }); continue; }
    const want = taglineFor(p!, rotationReason(p!, input.now));
    if (want !== ad.tagline) actions.push({ kind: 'UPDATE_TAGLINE', adId: ad.adId, productId: ad.productId, from: ad.tagline, to: want, why: 'The price or the reason changed; the headline must state today\'s facts.' });
    keep.push(ad);
  }

  // 2. candidates
  const running = new Set(keep.map((a) => a.productId));
  const candidates = input.products
    .filter((p) => !running.has(p.productId))
    .map((p) => ({ p, reason: rotationReason(p, input.now), bad: unadvertisable(p) }))
    .filter((c) => {
      if (!c.reason) return false;
      if (c.bad) { skipped.push({ productId: c.p.productId, why: `Would qualify (${REASON_WHY[c.reason]}) but ${c.bad}.` }); return false; }
      return true;
    })
    .sort((a, b) => REASON_RANK[b.reason!] - REASON_RANK[a.reason!] || sp(b.p.productId) - sp(a.p.productId) || b.p.orders30d - a.p.orders30d || a.p.productId.localeCompare(b.p.productId));

  const start = (c: (typeof candidates)[number]): RotationAction => {
    const tagline = taglineFor(c.p, c.reason);
    const why = `${c.p.name}: ${REASON_WHY[c.reason!]}.`;
    const paused = input.ads.find((a) => a.status === 'PAUSED' && a.productId === c.p.productId);
    return paused
      ? { kind: 'RESUME', adId: paused.adId, productId: c.p.productId, tagline, reason: c.reason!, why }
      : { kind: 'CREATE', productId: c.p.productId, tagline, clickthroughUrl: clickthroughUrl(c.p), imageUrl: c.p.imageUrl!, reason: c.reason!, why };
  };

  let free = max - keep.length;
  let i = 0;
  for (; free > 0 && i < candidates.length; i++, free--) actions.push(start(candidates[i]));

  // 3. one swap when full
  if (free <= 0 && i < candidates.length && keep.length) {
    const next = candidates[i];
    const weakest = keep
      .filter((a) => input.now.getTime() - a.startedAt.getTime() >= MIN_RUN_DAYS_BEFORE_SWAP * DAY && sp(a.productId) === 0)
      .map((a) => ({ a, r: rotationReason(byId.get(a.productId)!, input.now) }))
      .sort((x, y) => (x.r ? REASON_RANK[x.r] : 0) - (y.r ? REASON_RANK[y.r] : 0))[0];
    if (weakest && REASON_RANK[next.reason!] > (weakest.r ? REASON_RANK[weakest.r] : 0)) {
      actions.push({ kind: 'PAUSE', adId: weakest.a.adId, productId: weakest.a.productId,
        why: `Paused for a stronger product: no Spotify-attributed order in ${MIN_RUN_DAYS_BEFORE_SWAP}+ days.` });
      actions.push(start(next));
    }
  }

  const activeAfter = keep.length - actions.filter((a) => a.kind === 'PAUSE' && keep.some((k) => k.adId === a.adId)).length
    + actions.filter((a) => a.kind === 'CREATE' || a.kind === 'RESUME').length;
  return { actions, skipped, nothingToAdvertise: activeAfter === 0 };
}
