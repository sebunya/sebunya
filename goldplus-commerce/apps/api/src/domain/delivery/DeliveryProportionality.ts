import { FulfilmentMode } from './DeliveryFulfilmentMode';

/**
 * Proportionality (commercial constraint, 2026-08-06).
 *
 * "The delivery fee must never exceed the value of what is being bought."
 * Quoting 35,000 to ship a 20,000 cable is not an expensive delivery, it is a
 * broken proposition, and it must be impossible to present at checkout as a
 * normal option.
 *
 * Two rules, and the important thing about both is what they DO NOT do:
 * neither blocks a sale. The location module's rule holds — a data or pricing
 * gap never blocks a sale, it changes what we say. Here that means the
 * disproportionate option is demoted and explained, alternatives are offered,
 * and a customer who still wants it may have it with an explicit
 * acknowledgement. Never the default, never silent.
 *
 * Both thresholds ship UNSET, so nothing changes until an operator sets them.
 */

export interface ProportionalityConfig {
  /** Fee ÷ merchandise subtotal above which the fee is disproportionate. */
  feeToValueRatioCeiling: number | null;
  /** Per-mode basket floor. A bus shipment has a fixed cost either way. */
  minOrderValueUgx: Partial<Record<FulfilmentMode, number | null>>;
  /** Shown as the constructive alternative when one is configured. */
  freeDeliveryThresholdUgx: number | null;
}

export type ProportionalityFinding =
  | {
      kind: 'fee_exceeds_value';
      feeUgx: number;
      subtotalUgx: number;
      ratio: number;
      ceiling: number;
      /** Basket value at which this fee becomes proportionate. */
      proportionateAtUgx: number;
      /** How much more they would need to add to reach it. */
      addToReachProportionateUgx: number;
      /** And to reach free delivery, when a threshold exists. */
      freeDeliveryAtUgx: number | null;
      addToReachFreeUgx: number | null;
    }
  | {
      kind: 'below_minimum_order';
      mode: FulfilmentMode;
      subtotalUgx: number;
      minimumUgx: number;
      shortfallUgx: number;
    };

export interface ProportionalityResult {
  /** Empty means the quote may be presented as a normal option. */
  findings: ProportionalityFinding[];
  /**
   * True when the customer must actively acknowledge before this option can be
   * chosen. It is never pre-selected and never applied silently.
   */
  requiresAcknowledgement: boolean;
}

/**
 * Assess a quote against the basket it is for.
 *
 * Pure, and deliberately returns FINDINGS rather than a verdict: the surface
 * decides how to render "this costs more than the items are worth", and ops
 * reporting counts how often it happens. A boolean would throw away the numbers
 * the customer needs to see.
 */
export function assessProportionality(input: {
  feeUgx: number;
  /** Merchandise subtotal, on the same basis as the free-delivery threshold. */
  subtotalUgx: number;
  mode: FulfilmentMode;
  config: ProportionalityConfig;
}): ProportionalityResult {
  const findings: ProportionalityFinding[] = [];

  const minimum = input.config.minOrderValueUgx[input.mode] ?? null;
  if (minimum !== null && Number.isFinite(minimum) && input.subtotalUgx < minimum) {
    findings.push({
      kind: 'below_minimum_order',
      mode: input.mode,
      subtotalUgx: input.subtotalUgx,
      minimumUgx: minimum,
      shortfallUgx: minimum - input.subtotalUgx,
    });
  }

  const ceiling = input.config.feeToValueRatioCeiling;
  // Unset means the rule is off. A zero or negative subtotal cannot produce a
  // meaningful ratio, and dividing by it would produce Infinity — an empty
  // basket has no delivery decision to make anyway.
  if (ceiling !== null && Number.isFinite(ceiling) && ceiling > 0 && input.subtotalUgx > 0) {
    const ratio = input.feeUgx / input.subtotalUgx;
    if (ratio > ceiling) {
      const proportionateAt = Math.ceil(input.feeUgx / ceiling);
      const freeAt = input.config.freeDeliveryThresholdUgx;
      findings.push({
        kind: 'fee_exceeds_value',
        feeUgx: input.feeUgx,
        subtotalUgx: input.subtotalUgx,
        ratio,
        ceiling,
        proportionateAtUgx: proportionateAt,
        addToReachProportionateUgx: Math.max(0, proportionateAt - input.subtotalUgx),
        freeDeliveryAtUgx: freeAt,
        addToReachFreeUgx: freeAt === null ? null : Math.max(0, freeAt - input.subtotalUgx),
      });
    }
  }

  return {
    findings,
    // A disproportionate fee needs acknowledgement. A basket under the minimum
    // is informative only — telling someone their order is small and then
    // demanding they tick a box for it would be a dark pattern.
    requiresAcknowledgement: findings.some((f) => f.kind === 'fee_exceeds_value'),
  };
}

/**
 * The registry keys, so a caller never spells one itself.
 */
export const FEE_TO_VALUE_CEILING_KEY = 'fee_to_value_ratio_ceiling';
export const MIN_ORDER_VALUE_KEYS: Record<FulfilmentMode, string> = {
  own_rider: 'min_order_value_own_rider_ugx',
  bus_parcel: 'min_order_value_bus_parcel_ugx',
  pickup_only: 'min_order_value_pickup_only_ugx',
  unserviceable: 'min_order_value_unserviceable_ugx',
};

/** Read the per-mode minimums out of the live numeric configuration. */
export function minOrderValuesFromConfig(config: Record<string, number>): Partial<Record<FulfilmentMode, number | null>> {
  const out: Partial<Record<FulfilmentMode, number | null>> = {};
  for (const [mode, key] of Object.entries(MIN_ORDER_VALUE_KEYS) as Array<[FulfilmentMode, string]>) {
    const v = config[key];
    out[mode] = Number.isFinite(v) ? v : null;
  }
  return out;
}
