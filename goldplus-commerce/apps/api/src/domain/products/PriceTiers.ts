/**
 * Product price tiers (0127). Pure — no framework.
 *
 * The owner's rule: the website sells at Price D (the retail price) and, once
 * any discount is applied, the price must never go below Price A (the floor).
 * B and C are the workbook's intermediate tiers, preserved exactly and read by
 * no surface yet.
 */

export interface PriceTiers {
  floorPriceUgx: number | null;
  tierBPriceUgx: number | null;
  tierCPriceUgx: number | null;
}

export type PriceTiersResult = { ok: true; value: PriceTiers } | { ok: false; message: string };

function optionalInt(raw: unknown, label: string): { ok: true; value: number | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, message: `${label} must be a whole number of shillings greater than zero, or left empty.` };
  return { ok: true, value: n };
}

/**
 * Validates the tiers against the retail price they belong to. The floor may
 * equal the retail price (then no discount can apply) but never exceed it.
 */
export function parsePriceTiers(
  body: { floorPriceUgx?: unknown; tierBPriceUgx?: unknown; tierCPriceUgx?: unknown },
  retailPriceUgx: number,
): PriceTiersResult {
  const floor = optionalInt(body.floorPriceUgx, 'Floor price (Price A)');
  if (!floor.ok) return floor;
  const b = optionalInt(body.tierBPriceUgx, 'Price B');
  if (!b.ok) return b;
  const c = optionalInt(body.tierCPriceUgx, 'Price C');
  if (!c.ok) return c;
  if (floor.value !== null && floor.value > retailPriceUgx) {
    return {
      ok: false,
      message: `The floor (Price A, UGX ${floor.value.toLocaleString('en-UG')}) cannot be above the selling price (UGX ${retailPriceUgx.toLocaleString('en-UG')}). No discount could ever apply.`,
    };
  }
  return { ok: true, value: { floorPriceUgx: floor.value, tierBPriceUgx: b.value, tierCPriceUgx: c.value } };
}

/** The floor the engine and every display use for this product. */
export function floorFor(retailPriceUgx: number, floorPriceUgx: number | null | undefined): number {
  return floorPriceUgx == null || floorPriceUgx <= 0 ? retailPriceUgx : Math.min(floorPriceUgx, retailPriceUgx);
}
