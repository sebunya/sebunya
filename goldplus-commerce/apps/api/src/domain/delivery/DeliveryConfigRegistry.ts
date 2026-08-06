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
  /** A closed set of permitted values, for keys like a distance band. */
  allowedValues?: readonly string[];
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
    /**
     * A RATE, not a currency amount, and therefore `number` rather than `ugx`.
     *
     * The wizard proof caught this: 5,000 UGX over a 45 minute trip is 111.111
     * a minute, the operator was shown "UGX 111.1 a minute", and the `ugx` type
     * rounded it to 111 on the way into the database. A stored value that
     * disagrees with the working shown to the person who approved it is exactly
     * the drift this module exists to prevent, however small the amount.
     */
    key: 'rider_cost_per_minute_ugx',
    tier: 1,
    type: 'number',
    unit: 'UGX per minute',
    mandatory: true,
    defaultValue: null,
    min: 0.01,
    max: 100_000,
    label: 'What we pay a rider per minute',
    help: 'What a rider is paid for a delivery, divided by how many minutes it takes. Kept to the decimal, because it is a rate rather than a price.',
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

  // ── Where our own rider stops (commercial constraint, 2026-08-06) ───────
  /**
   * REQUIRED, and it ships unset.
   *
   * Above this band a destination is served by bus, not by a rider — outside
   * Kampala and the Wakiso metro it is not physically possible to send one.
   * Unset means we do not know where rider service ends, and the honest
   * consequence is that NOTHING is classified as own_rider, not that
   * everything is. The module then returns CONFIG_INCOMPLETE naming this key.
   *
   * Tier 2 because it is an area-serving decision rather than a price. The
   * launch wizard asks for it as a PLACE ("the furthest you would send your own
   * rider"), so it is derived from an operator's answer and never invented.
   */
  {
    key: 'own_rider_max_band',
    tier: 2,
    type: 'string',
    unit: 'distance band',
    mandatory: true,
    defaultValue: null,
    allowedValues: ['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6'],
    label: 'How far out our own rider goes',
    help: 'Anywhere further than this is shipped by bus to a parcel office instead. Set it by naming the furthest place you would send your own rider.',
  },

  // ── Proportionality (commercial constraint, 2026-08-06) ─────────────────
  {
    key: 'fee_to_value_ratio_ceiling',
    tier: 1,
    type: 'ratio',
    unit: '× the order value',
    mandatory: false,
    defaultValue: null,
    min: 0.01,
    max: 100,
    label: 'Warn when delivery costs more than this share of the order',
    help: 'A 35,000 delivery on a 20,000 cable is a broken proposition, not an expensive delivery. Above this we say so plainly, offer collection, and let the customer choose it anyway on purpose. It never blocks the sale. Unset means the check is off.',
  },
  {
    key: 'min_order_value_own_rider_ugx',
    tier: 1,
    type: 'ugx',
    unit: 'UGX',
    mandatory: false,
    defaultValue: null,
    min: 0,
    max: 100_000_000,
    label: 'Smallest order worth sending a rider for',
    help: 'Below this we tell the customer the minimum and how far off it they are. It never blocks the sale. Unset means no minimum.',
  },
  {
    key: 'min_order_value_bus_parcel_ugx',
    tier: 1,
    type: 'ugx',
    unit: 'UGX',
    mandatory: false,
    defaultValue: null,
    min: 0,
    max: 100_000_000,
    label: 'Smallest order worth shipping by bus',
    help: 'A bus parcel has a floor cost whatever is in it. Below this we say what the minimum is. It never blocks the sale. Unset means no minimum.',
  },

  // ── Parcel capacity (pre-decided, 2026-08-06) ──────────────────────────
  // How many items fit in one parcel of each class. Bus offices count PARCELS,
  // so this decides how many FEES a customer pays. All ship unset: splitting a
  // basket without knowing what a parcel holds would invent that number.
  // A single-item basket is one parcel regardless, which is arithmetic.
  ...(['small', 'medium', 'large'] as const).map((cls) => ({
    key: `parcel_capacity_${cls}_items`,
    tier: 1 as const,
    type: 'integer' as const,
    unit: 'items',
    mandatory: false,
    defaultValue: null,
    min: 1,
    max: 1000,
    label: `Items that fit in one ${cls} parcel`,
    help: `Above this the order ships as more than one parcel, and each parcel is charged. Unset means a multi-item ${cls} basket goes to the manual queue rather than guessing how many fees to charge.`,
  })),

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

  {
    key: 'implausible_rider_cost_ugx',
    tier: 1,
    type: 'ugx',
    unit: 'UGX',
    mandatory: false,
    defaultValue: 5_000_000,
    min: 1000,
    max: 100_000_000,
    label: 'Reject a rider cost above',
    help: 'A single delivery costing more than this is a typo, not a delivery. Raise it if a genuine long-haul run ever costs more.',
  },
  /**
   * The launch wizard's sanity bounds on the derived speed.
   *
   * These two are the ONLY numbers in this module that were chosen rather than
   * answered by an operator or fitted from data, and they are declared here so
   * that fact is visible rather than buried. They are the same class as
   * `implausible_rider_cost_ugx`: a typo guard, not a pricing parameter. Two
   * things keep them harmless — they can never alter a fee, and they only ever
   * WARN. The operator knows their city better than the check does.
   */
  {
    key: 'plausible_speed_min_kmh',
    tier: 1,
    type: 'number',
    unit: 'km/h',
    mandatory: false,
    defaultValue: 8,
    min: 1,
    max: 120,
    label: 'Warn if a derived speed is below',
    help: 'Only a warning on the setup wizard. It never changes a fee and never blocks a publish.',
  },
  {
    key: 'plausible_speed_max_kmh',
    tier: 1,
    type: 'number',
    unit: 'km/h',
    mandatory: false,
    defaultValue: 45,
    min: 1,
    max: 120,
    label: 'Warn if a derived speed is above',
    help: 'Only a warning on the setup wizard. It never changes a fee and never blocks a publish.',
  },
  {
    key: 'same_day_cutoff_eat',
    tier: 1,
    type: 'string',
    unit: 'HH:MM East Africa Time',
    mandatory: false,
    defaultValue: null,
    label: 'Same-day dispatch cutoff',
    help: 'Orders placed before this time in Kampala go out the same day. Unset means no same-day promise is made at all.',
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
    /**
     * The minimum sample a calibration proposal must rest on.
     *
     * Tier 1 and UNSET, the same treatment `window_min_sample_size` gets.
     * Shipping a figure would make it a launch value in disguise. Its absence
     * means NO PROPOSALS AT ALL — which is honest, because with zero
     * observations there is nothing to propose anyway, and it means the
     * threshold is a decision a human makes rather than one they inherit.
     */
    key: 'calibration_min_sample_size',
    tier: 1,
    type: 'integer',
    unit: 'deliveries',
    mandatory: false,
    defaultValue: null,
    min: 1,
    max: 10_000,
    label: 'Deliveries needed before the model may propose a change',
    help: 'Below this the nightly job reports "not enough data" instead of a proposal, and the queue refuses to accept one. Unset means no proposals are made at all.',
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
    key: 'copy_unavailable_area_too_coarse',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'We found your district. Choose the specific area you are in and we will show your exact delivery fee.',
    label: 'District known, area not yet chosen',
    help: 'NOT a refusal — the address resolved correctly, it is simply not precise enough to price. The interface offers the areas in that district. Never fall back to a district average: there is no such thing.',
  },
  {
    key: 'copy_variance_agreement_request',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'Your delivery address turned out to be in a different area from the one selected, so the delivery fee has changed. We need your agreement before we send the rider.',
    label: 'Asking a customer to agree a changed fee',
    help: 'Sent only when the change is above the absorption threshold. Below it we absorb the difference silently.',
  },
  /**
   * Bus shipment copy. It says SHIPMENT and COLLECTION, never "delivery to your
   * door", because that is not what happens and promising it creates the
   * dispute. This is a control, in the same way the rider sentence is.
   */
  {
    key: 'copy_carrier_required',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'We ship to your area by bus. Your parcel travels to a parcel office in your town and you collect it from there — our rider does not come to your door outside Kampala.',
    label: 'Served by bus rather than by our rider',
    help: 'Never reads as a refusal: the customer IS served. Say shipment and collection, never delivery to the door.',
  },
  {
    key: 'copy_unavailable_no_rate_card',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'We ship to your area by bus, but we do not have a current price for this destination yet. Place your order and our team will confirm the shipping cost with you before we send it.',
    label: 'Bus-served, no current rate card',
    help: 'A fact about us, not the customer — a carrier negotiation nobody has closed. It appears in an ops queue so somebody knows.',
  },
  {
    key: 'copy_fee_exceeds_value',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'Getting this to you costs more than the items in your basket are worth. You are welcome to go ahead, but it may be worth adding to your order or collecting from our Wilson Road shop instead.',
    label: 'Delivery costs more than the goods',
    help: 'Shown with the exact basket value that would make it proportionate. Never blocks the sale and never the pre-selected option.',
  },
  {
    key: 'copy_below_minimum_order',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'This order is below our minimum for this destination. You can still place it — we will confirm the arrangement with you before we send it.',
    label: 'Order below the minimum for its destination',
    help: 'Informative, never a block, and shown with the minimum and the shortfall.',
  },
  {
    key: 'copy_unavailable_parcel_class_unknown',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue:
      'We ship to your area by bus. Place your order and our team will confirm the shipping cost with you before we send it.',
    label: 'Shipping class not set for something in the basket',
    help: 'A gap in OUR product data, never the customer\'s fault, so the sentence says nothing about it. Ops sees the real cause in the manual queue.',
  },
  {
    key: 'copy_parcel_count_notice',
    tier: 1,
    type: 'string',
    unit: null,
    mandatory: false,
    defaultValue: 'Bus parcels are charged per parcel, so a larger order can ship as more than one.',
    label: 'Explaining per-parcel charging',
    help: 'Shown with the parcel count BEFORE the customer commits. Two parcels is two fees, and a surprise there is a dispute.',
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

/**
 * Every mandatory key, not only the Tier 1 launch numbers.
 *
 * `own_rider_max_band` is mandatory and Tier 2, so it gates activation without
 * being a seventh launch number — the brief forbids a seventh, and this is not
 * one: it is an area-serving decision, asked for as a place rather than typed
 * as a figure.
 */
export function missingMandatoryKeys(values: Record<string, string | number | undefined>): string[] {
  return DELIVERY_CONFIG_REGISTRY.filter((e) => e.mandatory).
    filter((e) => {
      const v = values[e.key];
      if (v === undefined || v === null || v === '') return true;
      if (e.type === 'string') return false;
      return !Number.isFinite(Number(v));
    })
    .map((e) => e.key);
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
  if (entry.allowedValues && !entry.allowedValues.includes(raw.trim())) {
    return { ok: false, message: `${entry.label} must be one of: ${entry.allowedValues.join(', ')}.` };
  }
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
