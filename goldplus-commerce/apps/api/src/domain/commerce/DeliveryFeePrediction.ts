/**
 * Delivery-fee prediction — geography prior, order-book posterior.
 *
 * THE MODEL, PLAINLY
 * Ugandan delivery cost is a step function of distance, not a smooth curve:
 * boda rings inside Greater Kampala, then bus-parcel bands upcountry. So the
 * predictor is deliberately a BAND TABLE over road-distance-from-Kampala —
 * eight numbers price the entire country, every one of them legible to the
 * operator who must answer for them. No opaque coefficients.
 *
 * THE LEARNING LOOP, WITHOUT ML THEATRE
 * Every time the logistics team confirms a real fee on an order, the order
 * book gains a labelled observation. Prediction consults those first: with
 * enough confirmed fees for a destination, the median of what the business
 * ACTUALLY charged beats any model — so OBSERVED overrides MODEL, and a
 * configured zone (the operator's standing promise) overrides both. The
 * "clever" part is recognising the order book already is the training set;
 * no new tables, no pipeline, no drift between systems.
 *
 *   ZONE (binding) > OBSERVED median (n >= MIN_OBSERVATIONS) > MODEL band
 *
 * Predictions are estimates until an operator adopts them. Nothing here ever
 * flips `deliveryFeeConfirmed` — that stays the zone resolver's monopoly.
 */

export interface DeliveryBandPolicy {
  /** Kampala inner core (≤ coreKm). */
  coreFeeUgx: number;
  /** Kampala city ring. */
  cityFeeUgx: number;
  /** Greater Kampala metro (Najjera, Kira, Nansana…). */
  metroFeeUgx: number;
  /** Metro edge / Entebbe ring. */
  metroEdgeFeeUgx: number;
  /** Near upcountry (Jinja, Masaka, Mityana band). */
  nearFeeUgx: number;
  /** Mid upcountry (Mbale, Mbarara, Gulu band). */
  midFeeUgx: number;
  /** Far upcountry (Arua, Kabale, Kitgum band). */
  farFeeUgx: number;
  /** Remote (Kaabong, Karenga band). */
  remoteFeeUgx: number;
  /** Estimates are only shown to customers while true. */
  enabled: boolean;
}

export type DeliveryBandKey =
  | 'CORE'
  | 'CITY'
  | 'METRO'
  | 'METRO_EDGE'
  | 'NEAR'
  | 'MID'
  | 'FAR'
  | 'REMOTE';

/** Band edges in km. Exported so the admin cockpit can explain itself. */
export const DELIVERY_BAND_EDGES_KM: ReadonlyArray<{ band: DeliveryBandKey; maxKm: number }> = [
  { band: 'CORE', maxKm: 6 },
  { band: 'CITY', maxKm: 12 },
  { band: 'METRO', maxKm: 25 },
  { band: 'METRO_EDGE', maxKm: 45 },
  { band: 'NEAR', maxKm: 160 },
  { band: 'MID', maxKm: 340 },
  { band: 'FAR', maxKm: 520 },
  { band: 'REMOTE', maxKm: Number.POSITIVE_INFINITY },
];

/**
 * Seed defaults, in UGX. Deliberately round numbers in the range Kampala
 * commerce actually quotes; they exist so the cockpit is never empty, and the
 * operator is expected to tune them — the policy row records who saved what.
 */
export const DEFAULT_DELIVERY_BAND_POLICY: DeliveryBandPolicy = {
  coreFeeUgx: 5_000,
  cityFeeUgx: 8_000,
  metroFeeUgx: 12_000,
  metroEdgeFeeUgx: 15_000,
  nearFeeUgx: 15_000,
  midFeeUgx: 20_000,
  farFeeUgx: 25_000,
  remoteFeeUgx: 30_000,
  enabled: true,
};

/** Confirmed order fees needed before observation overrides the model. */
export const MIN_OBSERVATIONS = 2;

export function bandForKm(km: number): DeliveryBandKey {
  for (const edge of DELIVERY_BAND_EDGES_KM) {
    if (km <= edge.maxKm) return edge.band;
  }
  return 'REMOTE';
}

export function bandFeeUgx(policy: DeliveryBandPolicy, band: DeliveryBandKey): number {
  switch (band) {
    case 'CORE': return policy.coreFeeUgx;
    case 'CITY': return policy.cityFeeUgx;
    case 'METRO': return policy.metroFeeUgx;
    case 'METRO_EDGE': return policy.metroEdgeFeeUgx;
    case 'NEAR': return policy.nearFeeUgx;
    case 'MID': return policy.midFeeUgx;
    case 'FAR': return policy.farFeeUgx;
    case 'REMOTE': return policy.remoteFeeUgx;
  }
}

export interface FeeObservationSummary {
  /** Median of confirmed delivery fees for this destination. */
  medianFeeUgx: number;
  sampleSize: number;
}

export type DeliveryEstimateSource = 'ZONE' | 'OBSERVED' | 'MODEL';

export interface DeliveryEstimate {
  kind: 'CONFIRMED' | 'ESTIMATED' | 'UNAVAILABLE';
  feeUgx: number | null;
  source: DeliveryEstimateSource | null;
  band: DeliveryBandKey | null;
  km: number | null;
  sampleSize: number;
  /** True when the observed median disagrees with the model by a notable margin. */
  observedDisagreesWithModel: boolean;
}

const DRIFT_RATIO = 0.25;

/**
 * Resolve one destination. `zoneFeeUgx` is non-null only for an ENABLED zone
 * (the operator's standing promise); `km` is null when geography has no entry
 * for the district — then the honest answer is UNAVAILABLE, never a guess.
 */
export function estimateDeliveryFee(input: {
  policy: DeliveryBandPolicy;
  km: number | null;
  zoneFeeUgx: number | null;
  observation: FeeObservationSummary | null;
}): DeliveryEstimate {
  const { policy, km, zoneFeeUgx, observation } = input;
  const band = km !== null ? bandForKm(km) : null;
  const modelFee = band !== null ? bandFeeUgx(policy, band) : null;
  const observed =
    observation && observation.sampleSize >= MIN_OBSERVATIONS ? observation : null;
  const drift = Boolean(
    observed && modelFee !== null && modelFee > 0 &&
      Math.abs(observed.medianFeeUgx - modelFee) / modelFee > DRIFT_RATIO,
  );

  if (zoneFeeUgx !== null) {
    return {
      kind: 'CONFIRMED', feeUgx: zoneFeeUgx, source: 'ZONE', band, km,
      sampleSize: observation?.sampleSize ?? 0, observedDisagreesWithModel: drift,
    };
  }
  if (!policy.enabled) {
    return { kind: 'UNAVAILABLE', feeUgx: null, source: null, band, km, sampleSize: observation?.sampleSize ?? 0, observedDisagreesWithModel: drift };
  }
  if (observed) {
    return {
      kind: 'ESTIMATED', feeUgx: observed.medianFeeUgx, source: 'OBSERVED', band, km,
      sampleSize: observed.sampleSize, observedDisagreesWithModel: drift,
    };
  }
  if (modelFee !== null) {
    return {
      kind: 'ESTIMATED', feeUgx: modelFee, source: 'MODEL', band, km,
      sampleSize: observation?.sampleSize ?? 0, observedDisagreesWithModel: false,
    };
  }
  return { kind: 'UNAVAILABLE', feeUgx: null, source: null, band: null, km: null, sampleSize: 0, observedDisagreesWithModel: false };
}

/** Median helper shared by the observation readers; empty input → null. */
export function medianUgx(fees: number[]): number | null {
  const clean = fees.filter((f) => Number.isFinite(f) && f > 0).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 1 ? clean[mid] : Math.round((clean[mid - 1] + clean[mid]) / 2);
}

/** A policy is storable only when every band fee is a sane positive integer. */
export function validateBandPolicy(input: Partial<DeliveryBandPolicy>): string | null {
  const fees: Array<[string, unknown]> = [
    ['coreFeeUgx', input.coreFeeUgx], ['cityFeeUgx', input.cityFeeUgx],
    ['metroFeeUgx', input.metroFeeUgx], ['metroEdgeFeeUgx', input.metroEdgeFeeUgx],
    ['nearFeeUgx', input.nearFeeUgx], ['midFeeUgx', input.midFeeUgx],
    ['farFeeUgx', input.farFeeUgx], ['remoteFeeUgx', input.remoteFeeUgx],
  ];
  for (const [name, value] of fees) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10_000_000) {
      return `${name} must be an integer between 0 and 10,000,000 UGX.`;
    }
  }
  if (typeof input.enabled !== 'boolean') return 'enabled must be true or false.';
  return null;
}
