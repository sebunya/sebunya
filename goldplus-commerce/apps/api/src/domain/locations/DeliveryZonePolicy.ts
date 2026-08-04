/**
 * Delivery zone policy activation rules (brief E.2 + approved decision #7).
 * Pure domain — no Hono, Drizzle, adapters.
 *
 * A zone is seeded with code and name only. EVERY policy value starts NULL and
 * null blocks activation — fees, SLAs and COD limits are Rob's decisions,
 * never defaults. Option A: `fallbackFeeUgx` here is the fee a district
 * INHERITS when no finer per-district zone price exists; the per-district
 * delivery_zones + band model remain the fee owner.
 */

export interface ZonePolicyInput {
  zoneCode: string;
  zoneName?: string | null;
  slaHoursMin?: number | null;
  slaHoursMax?: number | null;
  fallbackFeeUgx?: number | null;
  freeDeliveryThresholdUgx?: number | null;
  codAllowed?: boolean | null;
  codMaxOrderValueUgx?: number | null;
  prepayRequiredAboveUgx?: number | null;
  carrier?: string | null;
  active?: boolean;
}

export const ZONE_CODES = ['Z1', 'Z2', 'Z3', 'Z4'] as const;
export const CARRIERS = ['own_rider', 'third_party_rider', 'bus_parcel', 'courier', 'pickup_only'] as const;

export type ZonePolicyValidation =
  | { ok: true }
  | { ok: false; code: 'INVALID_ZONE' | 'INVALID_VALUE' | 'ACTIVATION_BLOCKED'; message: string; missing?: string[] };

const MAX_UGX = 100_000_000;

export function validateZonePolicy(input: ZonePolicyInput): ZonePolicyValidation {
  if (!ZONE_CODES.includes(input.zoneCode as (typeof ZONE_CODES)[number])) {
    return { ok: false, code: 'INVALID_ZONE', message: `Unknown zone "${input.zoneCode}".` };
  }
  for (const [field, value] of Object.entries({
    slaHoursMin: input.slaHoursMin,
    slaHoursMax: input.slaHoursMax,
    fallbackFeeUgx: input.fallbackFeeUgx,
    freeDeliveryThresholdUgx: input.freeDeliveryThresholdUgx,
    codMaxOrderValueUgx: input.codMaxOrderValueUgx,
    prepayRequiredAboveUgx: input.prepayRequiredAboveUgx,
  })) {
    if (value === null || value === undefined) continue;
    if (!Number.isInteger(value) || value < 0 || value > MAX_UGX) {
      return { ok: false, code: 'INVALID_VALUE', message: `"${field}" must be a whole non-negative number.` };
    }
  }
  if (
    input.slaHoursMin !== null &&
    input.slaHoursMin !== undefined &&
    input.slaHoursMax !== null &&
    input.slaHoursMax !== undefined &&
    input.slaHoursMax < input.slaHoursMin
  ) {
    return { ok: false, code: 'INVALID_VALUE', message: 'SLA max must not be below SLA min.' };
  }
  if (input.carrier !== null && input.carrier !== undefined && !CARRIERS.includes(input.carrier as (typeof CARRIERS)[number])) {
    return { ok: false, code: 'INVALID_VALUE', message: `Unknown carrier "${input.carrier}".` };
  }

  if (input.active) {
    // Unset means unset, and unset blocks activation (approved decision #7).
    const required: Array<[string, unknown]> = [
      ['slaHoursMin', input.slaHoursMin],
      ['slaHoursMax', input.slaHoursMax],
      ['fallbackFeeUgx', input.fallbackFeeUgx],
      ['freeDeliveryThresholdUgx', input.freeDeliveryThresholdUgx],
      ['codAllowed', input.codAllowed],
      ['carrier', input.carrier],
    ];
    // COD limits are only required when COD is allowed.
    if (input.codAllowed === true) {
      required.push(['codMaxOrderValueUgx', input.codMaxOrderValueUgx]);
      required.push(['prepayRequiredAboveUgx', input.prepayRequiredAboveUgx]);
    }
    const missing = required.filter(([, v]) => v === null || v === undefined).map(([k]) => k);
    if (missing.length > 0) {
      return {
        ok: false,
        code: 'ACTIVATION_BLOCKED',
        message: `Zone ${input.zoneCode} cannot activate: ${missing.join(', ')} unset. Unset means unset — set every value first.`,
        missing,
      };
    }
  }
  return { ok: true };
}
