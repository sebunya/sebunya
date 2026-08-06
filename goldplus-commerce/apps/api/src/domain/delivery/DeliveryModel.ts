import { LAUNCH_KEYS, LaunchKey } from './DeliveryConfigRegistry';
import type { FulfilmentMode } from './DeliveryFulfilmentMode';
import {
  ADDITIVE_PRIOR,
  LearnedFactorState,
  NEUTRAL_PRIOR,
  PriorFactor,
  factorSampleSize,
  factorValue,
  priorFactor,
} from './DeliveryLearnedFactor';

/**
 * THE model. One equation, and the fee and the window both come out of it, so
 * they cannot disagree (contract #2).
 *
 *   expected_minutes = handling + travel + last_mile
 *   quoted_fee       = max(minimum_fee, roundUp(cost_per_min × minutes × margin))
 *   window           = percentiles of expected_minutes, once there are any
 *
 * Everything here is pure: pass the inputs in, get the quote out. No database,
 * no clock, no configuration lookups. That is what makes every branch testable
 * and every quote reproducible from its own explanation record.
 */

/* ── Bands: arithmetic on the published edges, never judgement ───────────── */

export const BAND_EDGES_KM = {
  B0: [0, 2],
  B1: [2, 5],
  B2: [5, 9],
  B3: [9, 15],
  B4: [15, 25],
  B5: [25, 45],
  B6: [45, 70],
} as const;

export type DistanceBand = keyof typeof BAND_EDGES_KM;
export const DISTANCE_BANDS = Object.keys(BAND_EDGES_KM) as DistanceBand[];

/** Midpoint is (low + high) / 2. Computed, so it cannot drift from the edges. */
export function bandMidpointKm(band: DistanceBand): number {
  const [low, high] = BAND_EDGES_KM[band];
  return (low + high) / 2;
}

export function isDistanceBand(value: string): value is DistanceBand {
  return value in BAND_EDGES_KM;
}

/* ── Shrinkage: ONE formula, applied to every learned value ──────────────── */

/**
 * Weight moves from the prior to the observation as the sample grows:
 *
 *   shrunk = (n × observed + k × prior) / (n + k)
 *
 * `k` is the pseudo-count — the number of observations at which the estimate
 * is half prior and half evidence. There are no per-parameter special cases,
 * which is PART 9 #4: an area with no deliveries IS its prior, an area with a
 * few is nudged, an area with many is mostly itself.
 */
export const SHRINKAGE_PSEUDO_COUNT = 10;

export function shrinkToward(prior: number, observed: number | null, sampleSize: number): number {
  if (observed === null || sampleSize <= 0) return prior;
  const k = SHRINKAGE_PSEUDO_COUNT;
  return (sampleSize * observed + k * prior) / (sampleSize + k);
}

/**
 * The same one formula, applied to a factor STATE.
 *
 * A prior shrinks to itself — there is nothing to weigh against it — and a
 * human override is used as given, because a person who set a number did not
 * ask for it to be averaged with a guess.
 */
export function shrinkFactor(f: LearnedFactorState): number {
  if (f.kind === 'prior') return f.prior;
  if (f.kind === 'human') return f.value;
  return shrinkToward(f.prior, f.value, f.sampleSize);
}

/* ── Refusals ───────────────────────────────────────────────────────────── */

/**
 * One state cannot serve six situations. A customer in Gulu, a customer on
 * Koome and a customer waiting on the launch numbers need three different
 * sentences, and ops needs to tell them apart in the queue.
 */
export type UnavailableReason =
  | 'CONFIG_INCOMPLETE'
  | 'NO_ACTIVE_ORIGIN'
  /**
   * RETIRED 2026-08-06 and deliberately kept out of this union.
   *
   * `AREA_NOT_METRO` said where a customer was NOT. It was accurate and
   * useless: an Arua order is served, by bus, and the answer it now gets is
   * CARRIER_REQUIRED or NO_RATE_CARD. Nothing can produce AREA_NOT_METRO any
   * more, so it is gone rather than left as a reason with no path to it.
   */
  | 'AREA_UNSERVICEABLE'
  | 'WATER_ACCESS'
  | 'AREA_UNRESOLVED'
  /**
   * The address resolved to a DISTRICT and no further — "Kampala" is a real,
   * correct resolution that simply is not precise enough to price, because
   * corridor and band exist only at area granularity. This is not a refusal
   * and must not read like one: the customer narrows to an area and gets a
   * fee. Falling back to a district-average band would be inventing a fact
   * that does not exist.
   */
  | 'AREA_TOO_COARSE'
  /**
   * Served, but by bus rather than by our rider (commercial constraint,
   * 2026-08-06). NOT a refusal to serve, and it must never read as one: it
   * routes to the shipment flow, where the customer collects from a named
   * parcel office in their town.
   *
   * This replaces AREA_NOT_METRO as the answer for upcountry, which was
   * accurate and useless — it told an Arua customer where they were not.
   */
  | 'CARRIER_REQUIRED'
  /**
   * Bus-served, and no current rate card covers the destination. The manual
   * path handles the order and it appears in an ops queue, because a missing
   * card means a negotiation nobody has closed — a fact about us, not the
   * customer.
   */
  | 'NO_RATE_CARD'
  /**
   * No shipping class could be resolved for something in the basket — no
   * product override and no category default. A fact about OUR data, never the
   * customer's, and never guessed: small is the cheapest class, so a guess
   * would systematically under-charge and would only surface when a carrier
   * refused the parcel at the counter.
   */
  | 'PARCEL_CLASS_UNKNOWN';

export const UNAVAILABLE_REASONS: readonly UnavailableReason[] = [
  'CONFIG_INCOMPLETE',
  'NO_ACTIVE_ORIGIN',
  'AREA_UNSERVICEABLE',
  'WATER_ACCESS',
  'AREA_UNRESOLVED',
  'AREA_TOO_COARSE',
  'CARRIER_REQUIRED',
  'NO_RATE_CARD',
  'PARCEL_CLASS_UNKNOWN',
];

/** Reasons where the customer can act and immediately get a quote. */
export const ACTIONABLE_BY_CUSTOMER: readonly UnavailableReason[] = ['AREA_TOO_COARSE'];

/**
 * Reasons that route to the manual-quote ops queue rather than the
 * address-review queue. An upcountry order needs a price from a human; an
 * unresolved address needs someone to work out where it is. Different work,
 * different people.
 *
 * NO_RATE_CARD is here because the work it implies is commercial — someone has
 * to finish negotiating a carrier's fees for that route.
 */
export const MANUAL_QUOTE_REASONS: readonly UnavailableReason[] = ['NO_RATE_CARD', 'PARCEL_CLASS_UNKNOWN'];
export const ADDRESS_REVIEW_REASONS: readonly UnavailableReason[] = ['AREA_UNRESOLVED', 'AREA_TOO_COARSE'];

/**
 * Reasons that are NOT failures — the destination is served and the customer is
 * being told how. A surface that renders these in the refusal style is a bug.
 */
export const SERVED_BY_ANOTHER_MODE: readonly UnavailableReason[] = ['CARRIER_REQUIRED'];

/** The registry key holding the customer-facing string for each reason. */
export const REASON_COPY_KEY: Record<UnavailableReason, string> = {
  CONFIG_INCOMPLETE: 'copy_unavailable_config_incomplete',
  NO_ACTIVE_ORIGIN: 'copy_unavailable_no_active_origin',
  AREA_UNSERVICEABLE: 'copy_unavailable_area_unserviceable',
  WATER_ACCESS: 'copy_unavailable_water_access',
  AREA_UNRESOLVED: 'copy_unavailable_area_unresolved',
  AREA_TOO_COARSE: 'copy_unavailable_area_too_coarse',
  CARRIER_REQUIRED: 'copy_carrier_required',
  NO_RATE_CARD: 'copy_unavailable_no_rate_card',
  PARCEL_CLASS_UNKNOWN: 'copy_unavailable_parcel_class_unknown',
};

/* ── Rounding ───────────────────────────────────────────────────────────── */

/**
 * Round UP to the step. Rob set 500 because it is a currency denomination:
 * 4,317 is unusable in a cash market and a rider must be able to make change.
 * Applied after the margin and BEFORE the minimum-fee floor, so the floor is
 * always respected.
 */
export function roundUpTo(amount: number, step: number): number {
  if (!Number.isFinite(amount) || step <= 0) return Math.ceil(Math.max(0, amount));
  return Math.ceil(amount / step) * step;
}

/* ── Inputs ─────────────────────────────────────────────────────────────── */

export interface LaunchConfig {
  effective_speed_kmh: number;
  rider_cost_per_minute_ugx: number;
  handling_minutes: number;
  margin_multiplier: number;
  minimum_fee_ugx: number;
  /** Rob-set, always present. */
  fee_rounding_step_ugx: number;
}

/**
 * RETIRED SHAPE, 2026-08-06. `{ value, sampleSize }` could express a fitted 1.0
 * and an unlearned 1.0 identically, which is the defect stage D rule 1 forbids.
 * The model now takes `LearnedFactorState`, where a prior carries no `value` at
 * all — see `DeliveryLearnedFactor.ts`.
 */
export type LearnedFactor = LearnedFactorState;

/** Nothing learned. Contributes its prior and says so in every display. */
export const NEUTRAL_FACTOR: PriorFactor = priorFactor(NEUTRAL_PRIOR);
export const ADDITIVE_NEUTRAL_FACTOR: PriorFactor = priorFactor(ADDITIVE_PRIOR);

/**
 * A destination that RESOLVED to a gazetteer area.
 *
 * `corridor` and `band` are nullable here even though both are NOT NULL in
 * `delivery_corridor`, and the distinction matters: null means the area is not
 * in the 362-area metro corridor set at all. Conflating that with "the address
 * did not resolve" would tell an Adjumani customer we could not find their
 * address, when in fact we found it perfectly and simply do not price
 * upcountry automatically. Those are different sentences and different ops
 * queues, which is the whole reason the reason enum exists.
 */
export interface AreaInput {
  areaSlug: string;
  /**
   * How this destination is actually served. Resolved by
   * `resolveFulfilmentMode`; null means the rider ceiling is unset and we
   * therefore do not know.
   *
   * The computed minutes model below is reachable ONLY through
   * `OwnRiderArea`, which is this type narrowed to `fulfilmentMode:
   * 'own_rider'`. That is a type-level restriction, not a runtime check: there
   * is no branch inside `quoteDelivery` that a bus destination could take,
   * because it cannot be passed in at all.
   */
  fulfilmentMode?: FulfilmentMode | null;
  /**
   * True when the address resolved only as far as a district. Corridor and
   * band do not exist at that granularity, so no quote is possible — but the
   * customer is one choice away from one.
   */
  districtOnly?: boolean;
  /** The district, so the interface can offer the areas within it. */
  district?: string | null;
  corridor: string | null;
  band: DistanceBand | null;
  /** Only known for areas in the corridor set. */
  accessMode: 'road' | 'water' | null;
  serviceable: boolean;
  /** Measured centroid distance from the origin, when one exists. */
  measuredKm: number | null;
  centroidSource: 'delivered_pins' | 'manual' | null;
}

/**
 * An area the computed minutes model is ALLOWED to price.
 *
 * The commercial constraint of 2026-08-06 says the computed model must be
 * structurally unable to produce a fee outside own-rider range — "delete the
 * code path rather than guarding it". This type is that deletion: the model
 * takes `OwnRiderArea`, so there is no bus, water or unserviceable branch
 * inside it to reach. A caller holding a bus destination cannot call it, and a
 * caller who casts one in has left the type system deliberately, which review
 * catches and `narrowToOwnRider` makes unnecessary.
 */
export type OwnRiderArea = AreaInput & {
  fulfilmentMode: 'own_rider';
  corridor: string;
  band: DistanceBand;
};

/**
 * The only supported way in. Returns null for anything the computed model may
 * not price, so the caller must handle that case rather than forget it.
 */
export function narrowToOwnRider(area: AreaInput | null): OwnRiderArea | null {
  if (!area) return null;
  if (area.fulfilmentMode !== 'own_rider') return null;
  if (!area.corridor || !area.band) return null;
  return area as OwnRiderArea;
}

export interface QuoteInputs {
  config: Partial<Record<LaunchKey | 'fee_rounding_step_ugx', number>>;
  hasActiveOrigin: boolean;
  originCode: string | null;
  /** Narrowed: only an own-rider destination reaches the minutes model. */
  area: OwnRiderArea | null;
  /** Per-area factor, falling back to the corridor's, falling back to 1.0. */
  corridorFactor: LearnedFactor;
  hourFactor: LearnedFactor;
  detourFactor: LearnedFactor;
  lastMileMinutes: LearnedFactor;
  /** Completed deliveries for this area — gates the hour window. */
  areaSampleSize: number;
  /** Percentile pair, only meaningful once there is a sample AND a target. */
  observedMinutes: { p10: number; p90: number } | null;
  onTimeTargetBps: number | null;
  windowMinSampleSize: number | null;
  configVersionId: string | null;
}

/* ── Output: a quote that explains itself ───────────────────────────────── */

/**
 * Everything needed to answer "why is this the fee" without re-running
 * anything: origin, centroid source, corridor, band, every factor with its
 * sample size, the configuration version, the rounding applied, and the reason
 * code when there is no quote. Stage D depends on this and it is far cheaper
 * to write now than to backfill.
 */
export interface QuoteExplanation {
  originCode: string | null;
  areaSlug: string | null;
  corridor: string | null;
  band: DistanceBand | null;
  /** Which distance the quote used, and where it came from. */
  distanceSource: 'measured_centroid' | 'band_midpoint' | null;
  centroidSource: 'delivered_pins' | 'manual' | null;
  oneWayKm: number | null;
  roundTripKm: number | null;
  factors: Record<'corridor' | 'hour' | 'detour' | 'lastMile', LearnedFactor>;
  handlingMinutes: number | null;
  travelMinutes: number | null;
  lastMileMinutes: number | null;
  expectedMinutes: number | null;
  rawFeeUgx: number | null;
  roundingStepUgx: number | null;
  roundedFeeUgx: number | null;
  minimumFeeApplied: boolean;
  configVersionId: string | null;
  unavailableReason: UnavailableReason | null;
  missingConfigKeys: string[];
}

export type DeliveryWindow =
  | { kind: 'day'; note: 'insufficient_sample' | 'no_on_time_target' }
  | { kind: 'hours'; lowMinutes: number; highMinutes: number; sampleSize: number };

export type QuoteResult =
  | {
      available: true;
      feeUgx: number;
      expectedMinutes: number;
      window: DeliveryWindow;
      explanation: QuoteExplanation;
    }
  | {
      available: false;
      reason: UnavailableReason;
      explanation: QuoteExplanation;
    };

function emptyExplanation(inputs: QuoteInputs): QuoteExplanation {
  return {
    originCode: inputs.originCode,
    areaSlug: inputs.area?.areaSlug ?? null,
    corridor: inputs.area?.corridor ?? null,
    band: inputs.area?.band ?? null,
    distanceSource: null,
    centroidSource: inputs.area?.centroidSource ?? null,
    oneWayKm: null,
    roundTripKm: null,
    factors: {
      corridor: inputs.corridorFactor,
      hour: inputs.hourFactor,
      detour: inputs.detourFactor,
      lastMile: inputs.lastMileMinutes,
    },
    handlingMinutes: null,
    travelMinutes: null,
    lastMileMinutes: null,
    expectedMinutes: null,
    rawFeeUgx: null,
    roundingStepUgx: null,
    roundedFeeUgx: null,
    minimumFeeApplied: false,
    configVersionId: inputs.configVersionId,
    unavailableReason: null,
    missingConfigKeys: [],
  };
}

export function missingLaunchKeys(config: QuoteInputs['config']): LaunchKey[] {
  return LAUNCH_KEYS.filter((k) => {
    const v = config[k];
    return v === undefined || v === null || !Number.isFinite(v);
  });
}

/**
 * The delivery window.
 *
 * An hour window requires BOTH a sample big enough to compute percentiles from
 * AND an on-time target to tune against. Neither exists yet, so the honest
 * promise is day level. This is not a threshold anyone invented — it falls out
 * of two unset values, and when they are set the hour window is earned.
 *
 * A fabricated window is never widened to look cautious. We say less instead.
 */
export function deriveWindow(inputs: QuoteInputs): DeliveryWindow {
  if (inputs.onTimeTargetBps === null) return { kind: 'day', note: 'no_on_time_target' };
  const min = inputs.windowMinSampleSize;
  if (min === null || inputs.areaSampleSize < min || inputs.observedMinutes === null) {
    return { kind: 'day', note: 'insufficient_sample' };
  }
  return {
    kind: 'hours',
    lowMinutes: inputs.observedMinutes.p10,
    highMinutes: inputs.observedMinutes.p90,
    sampleSize: inputs.areaSampleSize,
  };
}

/**
 * Quote one destination. Refusals are checked in the order that gives the
 * customer the most useful sentence: an unresolved address is a different
 * problem from an unserviceable one, and both are different from our own
 * configuration not being finished.
 */
export function quoteDelivery(inputs: QuoteInputs): QuoteResult {
  const explanation = emptyExplanation(inputs);

  const refuse = (reason: UnavailableReason, missing: LaunchKey[] = []): QuoteResult => ({
    available: false,
    reason,
    explanation: { ...explanation, unavailableReason: reason, missingConfigKeys: missing },
  });

  // WHAT IS NOT HERE MATTERS.
  //
  // There is no bus branch, no water branch, no unserviceable branch and no
  // out-of-range branch in this function, because `OwnRiderArea` cannot carry
  // any of those states. The commercial constraint of 2026-08-06 asked for the
  // code path to be DELETED rather than guarded, and this is that deletion:
  // the 56,000 UGX six-hour round trip is not a number we decided not to show,
  // it is a number this function can no longer be asked for.
  //
  // Mode selection happens once, above, in `quoteFulfilment`. The two checks
  // left here are the ones an own-rider destination can still fail.

  // 1. Did the address resolve to something the model may price?
  if (!inputs.area) return refuse('AREA_UNRESOLVED');
  // 2. Our own faults, because they are not the customer's problem.
  if (!inputs.hasActiveOrigin) return refuse('NO_ACTIVE_ORIGIN');
  const missing = missingLaunchKeys(inputs.config);
  if (missing.length > 0) return refuse('CONFIG_INCOMPLETE', missing);

  const config = inputs.config as Required<LaunchConfig>;

  // Distance: a measured centroid always beats a band midpoint.
  const usingMeasured = inputs.area.measuredKm !== null && Number.isFinite(inputs.area.measuredKm);
  const oneWayKm = usingMeasured ? (inputs.area.measuredKm as number) : bandMidpointKm(inputs.area.band);
  const detour = shrinkFactor(inputs.detourFactor);
  const roundTripKm = oneWayKm * 2 * detour;

  const corridorFactor = shrinkFactor(inputs.corridorFactor);
  const hourFactor = shrinkFactor(inputs.hourFactor);

  const travelMinutes = (roundTripKm / config.effective_speed_kmh) * 60 * corridorFactor * hourFactor;
  // last_mile has no prior beyond zero added minutes; it is learned per area.
  const lastMile = shrinkFactor(inputs.lastMileMinutes);
  const expectedMinutes = config.handling_minutes + travelMinutes + lastMile;

  const rawFee = config.rider_cost_per_minute_ugx * expectedMinutes * config.margin_multiplier;
  const step = config.fee_rounding_step_ugx;
  const rounded = roundUpTo(rawFee, step);
  const feeUgx = Math.max(config.minimum_fee_ugx, rounded);

  return {
    available: true,
    feeUgx,
    expectedMinutes,
    window: deriveWindow(inputs),
    explanation: {
      ...explanation,
      distanceSource: usingMeasured ? 'measured_centroid' : 'band_midpoint',
      oneWayKm,
      roundTripKm,
      handlingMinutes: config.handling_minutes,
      travelMinutes,
      lastMileMinutes: lastMile,
      expectedMinutes,
      rawFeeUgx: rawFee,
      roundingStepUgx: step,
      roundedFeeUgx: rounded,
      minimumFeeApplied: feeUgx > rounded,
    },
  };
}

/**
 * Preview one real area in every band, for the mandatory confirmation when the
 * launch values are set. A speed anchor entered as 5 instead of 20 quadruples
 * every fee in the system, and this is the only place a human can catch it —
 * before publish, in numbers they recognise.
 */
export interface BandPreviewRow {
  band: DistanceBand;
  areaSlug: string;
  areaLabel: string;
  midpointKm: number;
  expectedMinutes: number | null;
  feeUgx: number | null;
  unavailableReason: UnavailableReason | null;
}

export function previewAcrossBands(
  samples: ReadonlyArray<{ band: DistanceBand; areaSlug: string; areaLabel: string; area: AreaInput }>,
  base: Omit<QuoteInputs, 'area'>,
): BandPreviewRow[] {
  return DISTANCE_BANDS.map((band) => {
    const sample = samples.find((s) => s.band === band);
    if (!sample) {
      return {
        band,
        areaSlug: '—',
        areaLabel: 'no area in this band',
        midpointKm: bandMidpointKm(band),
        expectedMinutes: null,
        feeUgx: null,
        unavailableReason: null,
      };
    }
    // A band beyond the rider ceiling has no computed fee to preview, because
    // the computed model cannot be asked about it. The row still appears —
    // showing the operator that B5 and B6 go by bus is the point, not a gap.
    const ownRider = narrowToOwnRider(sample.area);
    if (!ownRider) {
      return {
        band,
        areaSlug: sample.areaSlug,
        areaLabel: sample.areaLabel,
        midpointKm: bandMidpointKm(band),
        expectedMinutes: null,
        feeUgx: null,
        unavailableReason: 'CARRIER_REQUIRED',
      };
    }
    const result = quoteDelivery({ ...base, area: ownRider });
    return {
      band,
      areaSlug: sample.areaSlug,
      areaLabel: sample.areaLabel,
      midpointKm: bandMidpointKm(band),
      expectedMinutes: result.available ? result.expectedMinutes : null,
      feeUgx: result.available ? result.feeUgx : null,
      unavailableReason: result.available ? null : result.reason,
    };
  });
}
