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
}

const NONE: StorefrontDiscount = { active: false, percent: 0, percentBps: 0, endsIso: null, name: null };
const TTL_MS = 60_000;
let cached: StorefrontDiscount | null = null;
let cachedAt = 0;
let inflight: Promise<StorefrontDiscount> | null = null;

async function fetchDiscount(): Promise<StorefrontDiscount> {
  try {
    const res = await fetch(`${apiBase}/commerce/storefront-discount`, { signal: AbortSignal.timeout(2000) });
    const json: any = res.ok ? await res.json().catch(() => null) : null;
    const d = json?.success ? json.data : null;
    if (d?.active && Number(d.percentBps) > 0) {
      return { active: true, percent: Number(d.percent) || 0, percentBps: Number(d.percentBps) || 0, endsIso: d.endsIso ?? null, name: d.name ?? null };
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
 * The discounted unit price, using the evaluator's exact per-line formula
 * (floor(base * bps / 10000)) so display equals charge to the shilling.
 */
export function salePriceUgx(regularUgx: number, percentBps: number): number {
  return Math.max(0, regularUgx - Math.floor((regularUgx * percentBps) / 10_000));
}
