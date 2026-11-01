import { normalizeUgandaDistrict } from '@goldplus/shared';

/**
 * Delivery fee rules (Slice 3B). Pure domain — no Hono, Drizzle, or adapters.
 *
 * Fees are configured per Ugandan district by an administrator. When no
 * enabled zone covers the customer's district, the fee is truthfully
 * reported as "not yet confirmed" (0 UGX now, confirmed by staff after the
 * order) — we never invent a delivery price.
 */

export interface DeliveryZone {
  id: string;
  /** Canonical upper-cased district name, e.g. "KAMPALA". */
  district: string;
  feeUgx: number;
  enabled: boolean;
}

export interface DeliveryFeeResolution {
  feeUgx: number;
  /** True only when an enabled configured zone matched the district. */
  confirmed: boolean;
  zoneId: string | null;
}

/** Canonical district key: trimmed, upper-cased, single-spaced. */
export function normalizeDistrict(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function resolveDeliveryFee(zone: DeliveryZone | null): DeliveryFeeResolution {
  if (!zone || !zone.enabled) {
    return { feeUgx: 0, confirmed: false, zoneId: null };
  }
  return { feeUgx: zone.feeUgx, confirmed: true, zoneId: zone.id };
}

export interface DeliveryZoneInput {
  district: string;
  feeUgx: number;
  enabled: boolean;
}

export type DeliveryZoneValidation =
  | { ok: true; value: DeliveryZoneInput }
  | { ok: false; code: string; message: string };

const MAX_FEE_UGX = 10_000_000; // sanity ceiling; UGX are integer shillings

export function validateDeliveryZoneInput(input: {
  district?: unknown;
  feeUgx?: unknown;
  enabled?: unknown;
}): DeliveryZoneValidation {
  const districtRaw = typeof input.district === 'string' ? input.district : '';
  // Closed vocabulary: a zone for a district that does not exist is a fee no
  // order can ever match — refuse it here rather than let it sit dead in the
  // table. Canonicalises variants (Luweero → LUWERO) before the upper-cased
  // storage form.
  const canonical = normalizeUgandaDistrict(districtRaw);
  if (!canonical) {
    return { ok: false, code: 'INVALID_DISTRICT', message: `"${districtRaw.trim()}" is not a Uganda district.` };
  }
  const district = normalizeDistrict(canonical);
  const feeUgx = typeof input.feeUgx === 'number' ? input.feeUgx : Number.NaN;
  if (!Number.isInteger(feeUgx) || feeUgx < 0 || feeUgx > MAX_FEE_UGX) {
    return { ok: false, code: 'INVALID_FEE', message: 'Delivery fee must be a whole UGX amount between 0 and 10,000,000.' };
  }
  return { ok: true, value: { district, feeUgx, enabled: input.enabled === undefined ? true : Boolean(input.enabled) } };
}
