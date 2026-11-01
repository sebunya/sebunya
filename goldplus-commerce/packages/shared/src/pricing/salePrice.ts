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

/**
 * The floor that applies to ONE product under a campaign: the higher of the
 * campaign's own floor and the product's Price A. A product with no floor set
 * is held at its retail price — not discountable — because a silently-zero
 * floor is exactly how a storefront comes to advertise a price the basket will
 * not honour. This is the ONE place that rule is stated; every surface and the
 * evaluator's line builder call it.
 */
export function effectiveFloorUgx(
  campaignFloorUgx: number,
  productFloorUgx: number | null | undefined,
  retailUgx: number,
): number {
  if (productFloorUgx == null || !Number.isFinite(productFloorUgx) || productFloorUgx <= 0) return retailUgx;
  return Math.max(Math.max(0, campaignFloorUgx), productFloorUgx);
}

/** True only when the campaign actually takes something off THIS price. */
export function campaignSaves(regularUgx: number, percentBps: number, floorUgx: number): boolean {
  return salePriceUgx(regularUgx, percentBps, floorUgx) < regularUgx;
}
