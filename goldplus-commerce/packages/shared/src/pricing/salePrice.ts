/**
 * The discounted price for one basket line, using the pricing evaluator's exact
 * formula so that display equals charge to the shilling:
 *
 *   desired   = floor(base * bps / 10000)
 *   available = base - priceFloor * quantity        // PricingEvaluator L129
 *   charged   = base - min(desired, available)
 *
 * `floorUgx` is the floor for THIS base, so a caller passing a unit price passes
 * the per-unit floor and a caller passing a line total passes floor * quantity.
 * It is required, not defaulted: a silently-zero floor is precisely how the
 * storefront came to advertise a price the checkout would not honour.
 *
 * This lives in the shared package because every surface that shows a price has
 * to agree. The one copy that restated the arithmetic by hand left the floor
 * out and advertised UGX 139,500 for a product the basket charges 145,000 for.
 */
export function salePriceUgx(regularUgx: number, percentBps: number, floorUgx: number): number {
  const desired = Math.floor((regularUgx * percentBps) / 10_000);
  const available = Math.max(0, regularUgx - Math.max(0, floorUgx));
  return Math.max(0, regularUgx - Math.min(desired, available));
}

/** True only when the campaign actually takes something off THIS price. */
export function campaignSaves(regularUgx: number, percentBps: number, floorUgx: number): boolean {
  return salePriceUgx(regularUgx, percentBps, floorUgx) < regularUgx;
}
