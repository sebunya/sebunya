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

/**
 * The goods total the evaluator would charge for these lines, from the API's
 * own pricing preview (a dry run: no quote row is written). This is what the
 * cart and checkout pages show, because every product now carries its own
 * floor and only the evaluator holds all of them. On any failure it returns
 * `fallbackUgx` — the undiscounted subtotal — so the page can never advertise a
 * saving the basket will not honour; it can only under-promise.
 */
export async function quotedGoodsTotalUgx(
  items: Array<{ productId: string; quantity: number }>,
  fallbackUgx: number,
): Promise<number> {
  const lines = items.filter((i) => /^[0-9a-f-]{36}$/i.test(i.productId) && Number.isInteger(i.quantity) && i.quantity > 0);
  if (lines.length === 0) return fallbackUgx;
  try {
    const res = await fetch(`${apiBase}/commerce/pricing-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: lines, dryRun: true }),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return fallbackUgx;
    const json: any = await res.json().catch(() => null);
    const total = Number(json?.data?.goodsTotalUgx);
    return json?.success && Number.isFinite(total) && total >= 0 && total <= fallbackUgx ? total : fallbackUgx;
  } catch {
    return fallbackUgx;
  }
}
