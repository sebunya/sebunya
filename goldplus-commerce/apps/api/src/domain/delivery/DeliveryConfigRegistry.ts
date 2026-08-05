/**
 * The delivery configuration registry (brief PART 6).
 *
 * Every value the Control Centre can write is declared here once, with its
 * type, unit, range, tier, plain label and help text. A key outside this
 * registry cannot be written — that is what stops the settings table becoming
 * a junk drawer, and it is why `docs/delivery/CONFIGURATION.md` can be
 * generated rather than hand-maintained.
 *
 * NO INVENTED NUMBERS. Read the `defaultValue` column carefully:
 *   * the six launch values ship `null`. The module returns fee_unavailable
 *     with reason CONFIG_INCOMPLETE until every mandatory one is set.
 *   * `fee_rounding_step_ugx` ships 500 because Rob set it explicitly — 500 is
 *     a currency denomination, not a business parameter.
 *   * the customer-facing strings ship copy, because a module that must say
 *     something cannot say nothing. They are all Tier 1 editable, and none of
 *     them is hardcoded at a call site.
 *   * `window_min_sample_size` and the four PART 10 decisions ship `null`.
 *     Their absence produces a weaker, honest promise rather than a default.
 */

export type ConfigTier = 1 | 2 | 3;
export type ConfigType = 'number' | 'integer' | 'ugx' | 'ratio' | 'string' | 'boolean';

export interface ConfigEntry {
  key: string;
  tier: ConfigTier;
  type: ConfigType;
  unit: string | null;
  /** Mandatory values gate activation; optional ones simply stay off. */
  mandatory: boolean;
  /** null means "ships unset". Anything non-null is a value Rob chose. */
  defaultValue: string | number | boolean | null;
  min?: number;
  max?: number;
  label: string;
  help: string;
}

/**
 * The six launch values. Nothing else blocks activation, and there is no
 * seventh — a seventh would mean something was modelled that should have been
 * fitted.
 */
export const LAUNCH_KEYS = [
  'effective_speed_kmh',
  'rider_cost_per_minute_ugx',
  'handling_minutes',
  'margin_multiplier',
  'minimum_fee_ugx',
] as const;

export type LaunchKey = (typeof LAUNCH_KEYS)[number];

export const DELIVERY_CONFIG_REGISTRY: readonly ConfigEntry[] = [
  // ── The six launch values (five mandatory, one optional) ────────────────
  {
    key: 'effective_speed_kmh',
    tier: 1,
    type: 'number',
    unit: 'km/h',
    mandatory: true,
    defaultValue: null,
    min: 1,
    max: 120,
    label: 'How fast a rider actually covers ground',
    help: 'Average speed on a real run, including traffic and stops — not the speed limit. One typical Ntinda round trip is enough to work it out.',
  },
  {
    key: 'rider_cost_per_minute_ugx',
    tier: 1,
    type: 'ugx',
    unit: 'UGX per minute',
    mandatory: true,
    defaultValue: null,
    min: 1,
    max: 100_000,
    label: 'What we pay a rider per minute',
    help: 'What a rider is paid for a delivery, divided by how many minutes it takes.',
  },
  {
    key: 'handling_minutes',
    tier: 1,
    type: 'number',
    unit: 'minutes',
    mandatory: true,
    defaultValue: null,
    min: 0,
    max: 600,
    label: 'Minutes from order confirmed to rider leaving',
    help: 'Picking, packing and handing over. Not travel time.',
  },
  {
    key: 'margin_multiplier',
    tier: 1,
    type: 'ratio',
    unit: '×',
    mandatory: true,
    defaultValue: null,
    min: 1,
    max: 10,
    label: 'What goes on top of cost',
    help: '1.0 charges exactly what the delivery costs us. 1.3 adds thirty percent.',
  },
  {
    key: 'minimum_fee_ugx',
    tier: 1,
    type: 'ugx',
    unit: 'UGX',
    mandatory: true,
    defaultValue: null,
    min: 0,
    max: 10_000_000,
    label: 'The lowest delivery fee we will charge',
    help: 'Below this a delivery is not worth doing. Applied after rounding, so it is always respected.',
  },
  {
    key: 'free_delivery_threshold_ugx',
    tier: 1,
    type: 'ugx',
    unit: 'UGX',
    mandatory: false,
    defaultValue: null,
    min: 0,
    max: 100_000_000,
    label: 'Order value that earns free delivery',
    help: 'Optional. Ships off. Tested against the goods total AFTER promotional discounts and BEFORE loyalty points are applied, because points are tender rather than a price change.',
  },

  // ── Set by Rob explicitly ───────────────────────────────────────────────
  {
    key: 'fee_rounding_step_ugx',
    tier: 1,
    type: 'ugx',
    unit: 'UGX',
    mandatory: false,
    defaultValue: 500,
    min: 1,
    max: 100_000,
    label: 'Round the fee up to a multiple of',
    help: 'A quote of 4,317 is unusable in a cash market and a rider needs to make change. Applied after the margin and before the minimum fee.',
  },

  // ── Absent by design: their absence produces an honest weaker promise ────
  {
    key: 'window_min_sample_size',
    tier: 1,
    type: 'integer',
    unit: 'deliveries',
    mandatory: false,
    defaultValue: null,
    min: 1,
    max: 10_000,
    label: 'Deliveries needed before we promise an hour window',
    help: 'Until an area has this many completed deliveries we promise at day level — today, tomorrow — rather than inventing an hour range. Unset means day level everywhere.',
  },
  {
    key: 'on_time_target_bps',
    tier: 1,
    type: 'integer',
    unit: 'basis points',
    mandatory: false,
    defaultValue: null,
    min: 1,
    max: 10_000,
    label: 'How often a delivery must land inside its window',
    help: 'The window widens by itself until it hits this. Unset means no hour window is offered at all, because there is nothing to tune against.',
  },
  {
    key: 'variance_absorption_threshold_ugx',
    tier: 1,
    type: 'ugx',
    unit: 'UGX',
    mandatory: false,
    defaultValue: null,
    min: 0,
    max: 10_000_000,
    label: 'Fee difference we absorb without contacting the customer',
    help: 'Below this we absorb silently. Above it, ops must agree the change with the customer before dispatch.',
  },
  {
    key: 'variance_absorption_threshold_bps',
    tier: 1,
    type: 'integer',
    unit: 'basis points',
    mandatory: false,
    defaultValue: null,
    min: 0,
    max: 10_000,
    label: 'Or, as a share of the fee',
    help: 'Whichever of the two thresholds is reached first.',
  },
  {
    key: 'recalibration_fee_move_cap_bps',
    tier: 1,
    type: 'integer',
    unit: 'basis points',
    mandatory: false,
    defaultValue: null,
    min: 0,
    max: 10_000,
    label: 'Most one recalibration may move a fee',
    help: 'A proposal that moves a fee further than this needs a second approver.',
  },

  // ── Customer-facing strings. Copy, not numbers — but never hardcoded. ────
  {
    key: 'copy_estimate_stage1',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'Estimated from your area. Your exact delivery fee is confirmed at checkout, once you tell us where you are.',
    label: 'Before we know the area',
    help: 'Shown on the product page and in the cart, before a delivery area is chosen.',
  },
  {
    key: 'copy_fixed_stage2',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'This delivery fee is fixed for this order. It can only change if you change your delivery address, or if the address turns out to be in a different area from the one you selected. If that happens we will contact you and agree it before we deliver. Our rider will never ask you for a different amount at your door.',
    label: 'At checkout and on the confirmation',
    help: 'The last sentence is a control, not copy. It prevents the most common failure in this market.',
  },
  {
    key: 'copy_unavailable_config_incomplete',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'We are finalising delivery pricing for your area. Place your order and our team will confirm the delivery fee with you before dispatch.',
    label: 'When our pricing is not set up yet',
    help: 'Shown when the launch values have not been entered. The customer has done nothing wrong and the order still completes.',
  },
  {
    key: 'copy_unavailable_no_active_origin',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'We cannot quote delivery right now. Place your order and our team will confirm the delivery fee with you before dispatch.',
    label: 'When no dispatch point is active',
    help: 'An internal fault. Say nothing about the cause, and never quote a default.',
  },
  {
    key: 'copy_unavailable_area_not_metro',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'We deliver to your area, but the fee is quoted by our team rather than automatically. Place your order and we will confirm the delivery fee with you before dispatch.',
    label: 'Outside the Kampala metro area',
    help: 'Upcountry. A Gulu order must never be priced by a model fitted on Kampala boda journeys.',
  },
  {
    key: 'copy_unavailable_area_unserviceable',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'We are not able to deliver to this area at the moment. You are welcome to collect from our Wilson Road shop, or choose a different delivery address.',
    label: 'Area we do not serve',
    help: 'No quote at any price. Offer pickup and a different address.',
  },
  {
    key: 'copy_unavailable_water_access',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'This address is reached by boat, so we cannot deliver there yet. You are welcome to collect from our Wilson Road shop, or give us a mainland address.',
    label: 'Lake-access areas',
    help: 'The 12 water areas are pickup-only. No surcharge, no road quote.',
  },
  {
    key: 'copy_unavailable_area_unresolved',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'We could not match your address to an area. Place your order and our team will confirm the delivery fee with you before dispatch.',
    label: 'Address did not resolve',
    help: 'A data gap never blocks a sale — the order completes through the manual path.',
  },
  {
    key: 'copy_pickup_offer',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'Collect free from GoldPlus, Wilson Road — next to Uhuru Restaurant, opposite the Pioneer Mall parking area.',
    label: 'Pickup offer',
    help: 'Shown alongside every quote. Uhuru Restaurant first, Pioneer Mall as the wider fallback.',
  },
  {
    key: 'copy_pin_nudge',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue: 'Drop a location pin so our rider can find you first time.',
    label: 'Location pin request',
    help: 'Deliberately makes NO claim about time saved. No delivery has been completed with a pin yet, so any number would be invented. Add the claim here once the split is measured.',
  },
];

const BY_KEY = new Map(DELIVERY_CONFIG_REGISTRY.map((e) => [e.key, e]));

export function configEntry(key: string): ConfigEntry | null {
  return BY_KEY.get(key) ?? null;
}

/** A key outside the registry cannot be written. This is that rule. */
export function isWritableConfigKey(key: string): boolean {
  const entry = BY_KEY.get(key);
  return Boolean(entry) && entry!.tier !== 3;
}

export function registryDefaults(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of DELIVERY_CONFIG_REGISTRY) {
    if (e.defaultValue !== null) out[e.key] = String(e.defaultValue);
  }
  return out;
}

export type ConfigValidation = { ok: true; value: number | string | boolean } | { ok: false; message: string };

/** Validate against the declared type and range. Bad states unreachable. */
export function validateConfigValue(key: string, raw: string): ConfigValidation {
  const entry = BY_KEY.get(key);
  if (!entry) return { ok: false, message: `"${key}" is not a configurable value.` };
  if (entry.tier === 3) return { ok: false, message: `"${key}" is code-only and cannot be set here.` };
  if (entry.type === 'string') {
    if (!raw.trim()) return { ok: false, message: `${entry.label} cannot be empty.` };
    return { ok: true, value: raw.trim() };
  }
  if (entry.type === 'boolean') {
    if (!/^(true|false)$/i.test(raw.trim())) return { ok: false, message: `${entry.label} must be true or false.` };
    return { ok: true, value: /^true$/i.test(raw.trim()) };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, message: `${entry.label} must be a number.` };
  if (entry.type === 'integer' && !Number.isInteger(n)) {
    return { ok: false, message: `${entry.label} must be a whole number.` };
  }
  if (entry.type === 'ugx' && !Number.isInteger(n)) {
    return { ok: false, message: `${entry.label} must be a whole number of shillings.` };
  }
  if (entry.min !== undefined && n < entry.min) {
    return { ok: false, message: `${entry.label} cannot be below ${entry.min}${entry.unit ? ` ${entry.unit}` : ''}.` };
  }
  if (entry.max !== undefined && n > entry.max) {
    return { ok: false, message: `${entry.label} cannot be above ${entry.max}${entry.unit ? ` ${entry.unit}` : ''}.` };
  }
  return { ok: true, value: n };
}
