import { apiBase } from './api';

/**
 * The active site-wide discount campaign, for DISPLAY only. Mirrors what the
 * checkout evaluator charges (same source, same math), so the sale price shown on
 * a card/PDP/cart equals what the customer actually pays. Cached in-process with a
 * short TTL — it is the same for every visitor and must not add a fetch per card.
 */
export interface StorefrontDiscount {
  active: boolean;
  percent: number;      // whole-number percent, e.g. 10
  percentBps: number;   // basis points, e.g. 1000
  endsIso: string | null;
  name: string | null;
  /** Per-UNIT price floor the evaluator will not discount below. */
  priceFloorUgx: number;
}

const NONE: StorefrontDiscount = { active: false, percent: 0, percentBps: 0, endsIso: null, name: null, priceFloorUgx: 0 };
const TTL_MS = 60_000;
let cached: StorefrontDiscount | null = null;
let cachedAt = 0;
let inflight: Promise<StorefrontDiscount> | null = null;

async function fetchDiscount(): Promise<StorefrontDiscount> {
  try {
    const res = await fetch(`${apiBase}/commerce/storefront-discount`, { signal: AbortSignal.timeout(2000) });
    const json: any = res.ok ? await res.json().catch(() => null) : null;
    const d = json?.success ? json.data : null;
    // No floor field means an API too old to tell us where the evaluator stops
    // discounting. Advertise nothing rather than a price we cannot prove the
    // checkout will honour — showing MORE than we charge is safe, showing less
    // is a broken promise.
    if (d?.active && Number(d.percentBps) > 0 && Number.isFinite(Number(d.priceFloorUgx))) {
      return {
        active: true,
        percent: Number(d.percent) || 0,
        percentBps: Number(d.percentBps) || 0,
        endsIso: d.endsIso ?? null,
        name: d.name ?? null,
        priceFloorUgx: Math.max(0, Number(d.priceFloorUgx)),
      };
    }
  } catch {
    /* the storefront never blocks on the discount */
  }
  return NONE;
}

export async function getStorefrontDiscount(): Promise<StorefrontDiscount> {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = fetchDiscount()
    .then((d) => { cached = d; cachedAt = Date.now(); inflight = null; return d; })
    .catch(() => { inflight = null; return cached ?? NONE; });
  return inflight;
}

// The formula lives in @goldplus/shared so the API's Merchant Center feed and
// every storefront surface use ONE copy. Re-exported here so existing callers
// keep their import path.
// Imported from the shared package's pricing LEAF by path, not through the
// package name. Two things forbid the barrel here: it reaches node:crypto via
// checkout-intent, and this module is bundled for the browser by the
// recently-viewed rail, so the client build fails outright. A package.json
// "exports" subpath fixed that but changed how the API resolves the package at
// runtime, and the API then loaded raw TypeScript and would not boot. A
// relative import sidesteps package resolution altogether.
export { salePriceUgx, effectiveFloorUgx } from '../../../../packages/shared/src/pricing/salePrice';

/** The evaluator's own figures for a basket (a dry-run pricing preview). */
export interface BasketQuote {
  /** The basket at today's catalogue prices, before any promotion. */
  baseSubtotalUgx: number;
  /** Every automatic promotion the evaluator applies, floors and caps included. */
  discountUgx: number;
  /** What the goods will be charged: base less discount. */
  goodsTotalUgx: number;
}

/**
 * Asks the API's pricing preview (a dry run: no quote row is written) what the
 * evaluator would charge for these lines. Null on any failure, so a caller can
 * only ever under-promise.
 */
export async function quoteBasket(items: Array<{ productId: string; quantity: number }>): Promise<BasketQuote | null> {
  const lines = items.filter((i) => /^[0-9a-f-]{36}$/i.test(i.productId) && Number.isInteger(i.quantity) && i.quantity > 0);
  if (lines.length === 0) return null;
  try {
    const res = await fetch(`${apiBase}/commerce/pricing-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: lines, dryRun: true }),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const json: any = await res.json().catch(() => null);
    if (!json?.success) return null;
    const baseSubtotalUgx = Number(json.data?.baseSubtotalUgx);
    const discountUgx = Number(json.data?.discountTotalUgx);
    const goodsTotalUgx = Number(json.data?.goodsTotalUgx);
    if (![baseSubtotalUgx, discountUgx, goodsTotalUgx].every((n) => Number.isFinite(n) && n >= 0)) return null;
    return { baseSubtotalUgx, discountUgx, goodsTotalUgx };
  } catch {
    return null;
  }
}

/**
 * The goods total the evaluator would charge for these lines. On any failure it
 * returns `fallbackUgx` (the undiscounted subtotal), so the page can never
 * advertise a saving the basket will not honour; it can only under-promise.
 */
export async function quotedGoodsTotalUgx(
  items: Array<{ productId: string; quantity: number }>,
  fallbackUgx: number,
): Promise<number> {
  const quote = await quoteBasket(items);
  return quote && quote.goodsTotalUgx <= fallbackUgx ? quote.goodsTotalUgx : fallbackUgx;
}

/**
 * The saving the evaluator gives this basket, for the cart and checkout
 * summaries. Asked for EVERY basket, not only while a simple site-wide
 * campaign runs: an automatic promotion with a condition ("UGX 20,000 off
 * above 500,000"), a cap, an exclusion or product targets is not advertised
 * as a storefront campaign, yet the evaluator still charges it, so the pages
 * showed the undiscounted total while PesaPal asked for less. Clamped to the
 * subtotal the page shows; 0 on any failure.
 */
export async function basketSavingUgx(
  items: Array<{ productId: string; quantity: number }>,
  subtotalUgx: number,
): Promise<number> {
  if (subtotalUgx <= 0) return 0;
  const quote = await quoteBasket(items);
  if (!quote) return 0;
  return Math.min(subtotalUgx, Math.max(0, Math.floor(quote.discountUgx)));
}

/**
 * The words beside that saving. The campaign's percentage is named only when
 * the saving IS that percentage of every line; per-product floors (Price A)
 * cut it line by line, and "10% discount -UGX 18,500" on a 330,000 basket
 * (5.6%) reads as short-changing. Otherwise it is a plain "Sale saving".
 */
export function basketSavingLabel(
  campaign: StorefrontDiscount,
  lines: Array<{ unitPriceUgx: number; quantity: number }>,
  savingUgx: number,
): string {
  const named = campaign.active && campaign.name ? ` · ${campaign.name}` : '';
  if (campaign.active && campaign.percentBps > 0 && savingUgx > 0) {
    const fullPercent = lines.reduce(
      (sum, l) => sum + Math.floor((l.unitPriceUgx * l.quantity * campaign.percentBps) / 10_000),
      0,
    );
    if (fullPercent === savingUgx) return `${campaign.percent}% off${named}`;
  }
  return `Sale saving${named}`;
}
