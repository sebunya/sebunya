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
// Imported from the PRICING SUBPATH, not the package barrel. The barrel
// reaches node:crypto through checkout-intent, and this module is pulled
// into a browser bundle by the recently-viewed rail, which fails the client
// build outright.
export { salePriceUgx } from '@goldplus/shared/pricing';
