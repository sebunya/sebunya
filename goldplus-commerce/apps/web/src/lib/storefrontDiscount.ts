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

/**
 * The discounted price for one basket line, using the evaluator's exact formula
 * so display equals charge to the shilling:
 *
 *   desired   = floor(base * bps / 10000)
 *   available = base - priceFloor * quantity        // PricingEvaluator L129
 *   charged   = base - min(desired, available)
 *
 * `floorUgx` is the floor for THIS base, so a caller passing a unit price passes
 * the per-unit floor and a caller passing a line total passes floor * quantity.
 * It is required, not defaulted: a silently-zero floor is precisely how the
 * display came to advertise a price the checkout would not honour.
 */
export function salePriceUgx(regularUgx: number, percentBps: number, floorUgx: number): number {
  const desired = Math.floor((regularUgx * percentBps) / 10_000);
  const available = Math.max(0, regularUgx - Math.max(0, floorUgx));
  return Math.max(0, regularUgx - Math.min(desired, available));
}
