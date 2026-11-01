import { FactorKind, FittedFactor, LearnedFactorState, fittedFactor, priorFactor } from './DeliveryLearnedFactor';

/**
 * The fitting arithmetic (brief PART 4, stage D).
 *
 * Pure. Every function here takes observations and returns either a fit or an
 * explicit "not enough data" — never a number with a small sample quietly
 * attached to it.
 *
 * FIVE RULES, all of which have to hold at ZERO observations, because that is
 * the state this ships in and will stay in for a while:
 *
 *   1. zero samples is UNDEFINED, never 1.0, and never displayed as fitted
 *   2. no proposal below the minimum sample — `insufficient_data`, not a small
 *      number. And the queue REFUSES acceptance rather than warning
 *   3. every division is guarded; every fitting function is tested at n=0 and
 *      n=1
 *   4. recompute statelessly from full history, so running twice changes
 *      nothing and a bad night fixes itself
 *   5. no synthetic data ever reaches production
 */

export interface Observation {
  areaSlug: string | null;
  corridor: string | null;
  /** Hour of week in EAT, 0–167. */
  eatHourOfWeek: number | null;
  /** What the model said before the delivery happened. */
  predictedMinutes: number | null;
  /** What it actually took. */
  actualMinutes: number | null;
  /** Straight-line distance we assumed. */
  straightLineKm: number | null;
  /** Distance the rider actually covered, when the app recorded it. */
  distanceTravelledKm: number | null;
  hadPin: boolean | null;
  quotedFeeUgx: number | null;
  finalFeeUgx: number | null;
  actualRiderCostUgx: number | null;
  varianceReason: string | null;
}

export type FitOutcome =
  | { kind: 'fitted'; factor: FittedFactor; sampleSize: number }
  | {
      kind: 'insufficient_data';
      sampleSize: number;
      /** How many more observations are needed, when a minimum is set. */
      needed: number | null;
      /** Why nothing was proposed, in words an operator can read. */
      reason: 'below_minimum_sample' | 'no_minimum_configured' | 'no_usable_observations';
    };

/**
 * Fit one multiplicative factor from observed against predicted.
 *
 * `minSample` is Tier 1 and ships UNSET. Unset means NO PROPOSALS AT ALL rather
 * than a threshold anyone invented — the same treatment `window_min_sample_size`
 * gets. With zero observations that changes nothing in practice, and when the
 * observations arrive it is a decision a human makes rather than one they
 * inherit.
 */
export function fitRatioFactor(input: {
  observations: readonly Observation[];
  minSample: number | null;
  prior: number;
}): FitOutcome {
  // Only pairs where BOTH sides are real numbers and the denominator is
  // non-zero can contribute. Everything else is dropped, not defaulted.
  const usable = input.observations.filter(
    (o) =>
      o.predictedMinutes !== null &&
      o.actualMinutes !== null &&
      Number.isFinite(o.predictedMinutes) &&
      Number.isFinite(o.actualMinutes) &&
      o.predictedMinutes > 0,
  );
  const n = usable.length;

  if (input.minSample === null) {
    return { kind: 'insufficient_data', sampleSize: n, needed: null, reason: 'no_minimum_configured' };
  }
  if (n === 0) {
    return { kind: 'insufficient_data', sampleSize: 0, needed: input.minSample, reason: 'no_usable_observations' };
  }
  if (n < input.minSample) {
    return { kind: 'insufficient_data', sampleSize: n, needed: input.minSample - n, reason: 'below_minimum_sample' };
  }

  // Sum of actuals over sum of predicted, which weights by trip length rather
  // than treating a five-minute run and a two-hour one as equal evidence.
  const totalActual = usable.reduce((s, o) => s + (o.actualMinutes as number), 0);
  const totalPredicted = usable.reduce((s, o) => s + (o.predictedMinutes as number), 0);
  if (totalPredicted <= 0) {
    return { kind: 'insufficient_data', sampleSize: n, needed: null, reason: 'no_usable_observations' };
  }
  const ratio = totalActual / totalPredicted;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return { kind: 'insufficient_data', sampleSize: n, needed: null, reason: 'no_usable_observations' };
  }
  const factor = fittedFactor({ value: ratio, sampleSize: n, prior: input.prior });
  if (factor.kind !== 'fitted') {
    return { kind: 'insufficient_data', sampleSize: n, needed: null, reason: 'no_usable_observations' };
  }
  return { kind: 'fitted', factor, sampleSize: n };
}

/** Detour: distance actually covered against the straight line we assumed. */
export function fitDetourFactor(input: {
  observations: readonly Observation[];
  minSample: number | null;
}): FitOutcome {
  const usable = input.observations.filter(
    (o) =>
      o.straightLineKm !== null &&
      o.distanceTravelledKm !== null &&
      Number.isFinite(o.straightLineKm) &&
      Number.isFinite(o.distanceTravelledKm) &&
      o.straightLineKm > 0,
  );
  const n = usable.length;
  if (input.minSample === null) {
    return { kind: 'insufficient_data', sampleSize: n, needed: null, reason: 'no_minimum_configured' };
  }
  if (n === 0) return { kind: 'insufficient_data', sampleSize: 0, needed: input.minSample, reason: 'no_usable_observations' };
  if (n < input.minSample) {
    return { kind: 'insufficient_data', sampleSize: n, needed: input.minSample - n, reason: 'below_minimum_sample' };
  }
  const totalActual = usable.reduce((s, o) => s + (o.distanceTravelledKm as number), 0);
  const totalStraight = usable.reduce((s, o) => s + (o.straightLineKm as number), 0);
  if (totalStraight <= 0) return { kind: 'insufficient_data', sampleSize: n, needed: null, reason: 'no_usable_observations' };
  const factor = fittedFactor({ value: totalActual / totalStraight, sampleSize: n, prior: 1 });
  if (factor.kind !== 'fitted') return { kind: 'insufficient_data', sampleSize: n, needed: null, reason: 'no_usable_observations' };
  return { kind: 'fitted', factor, sampleSize: n };
}

/**
 * Last-mile minutes, SPLIT BY WHETHER A PIN WAS PRESENT.
 *
 * This is what justifies the pin nudge to customers, and it is why the nudge
 * ships with no time claim: until both halves have a sample there is no
 * difference to quote, and quoting one would be inventing it.
 */
export interface LastMileSplit {
  withPin: FitOutcome;
  withoutPin: FitOutcome;
  /** Minutes saved by having a pin. NULL until BOTH sides are fitted. */
  savingMinutes: number | null;
}

export function fitLastMileSplit(input: {
  observations: readonly Observation[];
  minSample: number | null;
}): LastMileSplit {
  const fitSide = (obs: readonly Observation[]): FitOutcome => {
    const usable = obs.filter(
      (o) =>
        o.actualMinutes !== null &&
        o.predictedMinutes !== null &&
        Number.isFinite(o.actualMinutes) &&
        Number.isFinite(o.predictedMinutes),
    );
    const n = usable.length;
    if (input.minSample === null) {
      return { kind: 'insufficient_data', sampleSize: n, needed: null, reason: 'no_minimum_configured' };
    }
    if (n === 0) return { kind: 'insufficient_data', sampleSize: 0, needed: input.minSample, reason: 'no_usable_observations' };
    if (n < input.minSample) {
      return { kind: 'insufficient_data', sampleSize: n, needed: input.minSample - n, reason: 'below_minimum_sample' };
    }
    // Excess minutes over what the model predicted, averaged. Guarded: n > 0
    // is established above.
    const excess = usable.reduce((s, o) => s + ((o.actualMinutes as number) - (o.predictedMinutes as number)), 0) / n;
    const factor = fittedFactor({ value: Math.max(0, excess), sampleSize: n, prior: 0 });
    if (factor.kind !== 'fitted') return { kind: 'insufficient_data', sampleSize: n, needed: null, reason: 'no_usable_observations' };
    return { kind: 'fitted', factor, sampleSize: n };
  };

  const withPin = fitSide(input.observations.filter((o) => o.hadPin === true));
  const withoutPin = fitSide(input.observations.filter((o) => o.hadPin === false));
  const saving =
    withPin.kind === 'fitted' && withoutPin.kind === 'fitted'
      ? withoutPin.factor.value - withPin.factor.value
      : null;
  return { withPin, withoutPin, savingMinutes: saving };
}

/**
 * Percentiles for the delivery window.
 *
 * Nearest-rank on a sorted sample. Returns null below the minimum rather than a
 * percentile of three numbers, which is not a percentile.
 */
export function fitWindowPercentiles(input: {
  observations: readonly Observation[];
  minSample: number | null;
  lowPct: number;
  highPct: number;
}): { p10: number; p90: number; sampleSize: number } | null {
  const minutes = input.observations
    .map((o) => o.actualMinutes)
    .filter((m): m is number => m !== null && Number.isFinite(m) && m > 0)
    .sort((a, b) => a - b);
  if (input.minSample === null || minutes.length === 0 || minutes.length < input.minSample) return null;
  const at = (pct: number) => {
    const rank = Math.ceil((pct / 100) * minutes.length);
    // Clamped: rank 0 would index off the front, rank > length off the back.
    return minutes[Math.min(minutes.length - 1, Math.max(0, rank - 1))];
  };
  return { p10: at(input.lowPct), p90: at(input.highPct), sampleSize: minutes.length };
}

/**
 * Reband flag: the measured distance for an area consistently contradicts the
 * band it was seeded into.
 *
 * FLAGGED, NEVER EDITED. "The corridor file is a prior, not a price list" — an
 * area drifting out of its band is expected, and a model that silently rebands
 * areas overnight is one nobody can explain to a customer or an accountant.
 */
export interface RebandFlag {
  areaSlug: string;
  seededBand: string;
  measuredMedianKm: number;
  suggestedBand: string;
  sampleSize: number;
}

export function flagRebands(input: {
  areas: ReadonlyArray<{ areaSlug: string; seededBand: string; measuredKm: readonly number[] }>;
  bandFor: (km: number) => string | null;
  minSample: number | null;
}): RebandFlag[] {
  if (input.minSample === null) return [];
  const out: RebandFlag[] = [];
  for (const a of input.areas) {
    const kms = a.measuredKm.filter((k) => Number.isFinite(k) && k > 0).sort((x, y) => x - y);
    if (kms.length === 0 || kms.length < input.minSample) continue;
    const median = kms.length % 2 === 1 ? kms[(kms.length - 1) / 2] : (kms[kms.length / 2 - 1] + kms[kms.length / 2]) / 2;
    const suggested = input.bandFor(median);
    if (suggested && suggested !== a.seededBand) {
      out.push({
        areaSlug: a.areaSlug,
        seededBand: a.seededBand,
        measuredMedianKm: median,
        suggestedBand: suggested,
        sampleSize: kms.length,
      });
    }
  }
  return out;
}

/* ── Reports, which render their own emptiness in WORDS ──────────────────── */

export interface VarianceReportRow {
  reason: string;
  count: number;
  totalDeltaUgx: number;
  absorbedCount: number;
  absorbedUgx: number;
  agreedCount: number;
  declinedCount: number;
}

export interface EmptyExplanation {
  /** What exists right now. */
  has: string;
  /** What is missing. */
  missing: string;
  /** What would have to be true for this report to say something. */
  needs: string;
}

/**
 * "A blank table is a support ticket." Every report states what exists, what is
 * missing, and what would need to be true for it to produce something.
 */
export function explainEmptiness(input: {
  observations: number;
  deliveredOrders: number;
  riderCostsRecorded: number;
  minSample: number | null;
}): EmptyExplanation | null {
  if (input.observations > 0 && input.riderCostsRecorded > 0 && input.minSample !== null) return null;
  const missing: string[] = [];
  const needs: string[] = [];
  if (input.deliveredOrders === 0) {
    missing.push('no order has been delivered');
    needs.push('one order completing through every fulfilment state');
  }
  if (input.riderCostsRecorded === 0) {
    missing.push('no rider cost has been recorded');
    needs.push('the amount actually paid to a rider entered against a delivered order');
  }
  if (input.minSample === null) {
    missing.push('no minimum sample size is set');
    needs.push('a minimum sample size, so a proposal cannot rest on two deliveries');
  }
  return {
    has: `${input.observations} observation${input.observations === 1 ? '' : 's'}, ${input.deliveredOrders} delivered order${input.deliveredOrders === 1 ? '' : 's'}, ${input.riderCostsRecorded} rider cost${input.riderCostsRecorded === 1 ? '' : 's'} recorded`,
    missing: missing.join('; ') || 'nothing',
    needs: needs.join('; ') || 'nothing',
  };
}

/** Every factor state the store can hold, so a caller never invents one. */
export function outcomeToState(outcome: FitOutcome, prior: number): LearnedFactorState {
  return outcome.kind === 'fitted' ? outcome.factor : priorFactor(prior);
}

export type { FactorKind };
