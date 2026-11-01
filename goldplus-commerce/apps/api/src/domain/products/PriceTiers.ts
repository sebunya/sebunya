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

type TierBody = { floorPriceUgx?: unknown; tierBPriceUgx?: unknown; tierCPriceUgx?: unknown };
const TIER_KEYS = ['floorPriceUgx', 'tierBPriceUgx', 'tierCPriceUgx'] as const;

/**
 * An edit only changes the tiers it SENDS. A request that leaves a tier key
 * out keeps the stored value — before 2026-09-24 an omitted key parsed as
 * "empty" and silently wiped Price A/B/C. An explicitly empty value ('' or
 * null) still clears the tier.
 */
export function tiersWithStoredDefaults(body: TierBody | null | undefined, stored: PriceTiers | null | undefined): TierBody {
  const out: TierBody = {};
  for (const key of TIER_KEYS) {
    out[key] = body && Object.prototype.hasOwnProperty.call(body, key) ? body[key] : stored?.[key] ?? null;
  }
  return out;
}

/**
 * Which money fields an edit changes: the retail price (Price D) or any tier,
 * the floor (Price A) above all — it caps every discount. A change here is a
 * pricing decision, not a catalogue edit.
 */
export function changedPricingFields(
  before: { retailPriceUgx: number; tiers: PriceTiers | null | undefined },
  after: { retailPriceUgx: number; tiers: PriceTiers },
): string[] {
  const changed: string[] = [];
  if (Number(before.retailPriceUgx) !== Number(after.retailPriceUgx)) changed.push('retail price (Price D)');
  const labels: Record<(typeof TIER_KEYS)[number], string> = { floorPriceUgx: 'floor (Price A)', tierBPriceUgx: 'Price B', tierCPriceUgx: 'Price C' };
  for (const key of TIER_KEYS) {
    if ((before.tiers?.[key] ?? null) !== (after.tiers[key] ?? null)) changed.push(labels[key]);
  }
  return changed;
}
