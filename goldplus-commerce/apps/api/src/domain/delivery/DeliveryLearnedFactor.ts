/**
 * Learned factors, with unlearned and fitted made UNREPRESENTABLE as the same
 * type (stage D rule 1, sharpened 2026-08-06).
 *
 * The gap this closes: `{ value: 1, sampleSize: 0 }` and `{ value: 1,
 * sampleSize: 40 }` both compute to 1.0, which is correct — that is what a
 * prior is for — but they are DIFFERENT FACTS. One means "we have learned
 * nothing about this corridor". The other means "we measured it forty times and
 * it really is neutral". A display that shows both as "1.0" tells an operator
 * the model knows something it does not.
 *
 * The same approach that worked for `OwnRiderArea`: rather than a flag someone
 * must remember to check, the two are different shapes. A `PriorFactor` has no
 * `value` field at all — there is nothing to read, because nothing was learned
 * — so code that wants a number must go through `factorValue()` and code that
 * wants to display one must go through `describeFactor()`, and neither can
 * silently treat an absence as a measurement.
 */

/** Nothing has been learned. Deliberately carries NO value to read. */
export interface PriorFactor {
  readonly kind: 'prior';
  /** What the model falls back on. Named `prior`, never `value`. */
  readonly prior: number;
}

/** Fitted from observations. Always carries its evidence with it. */
export interface FittedFactor {
  readonly kind: 'fitted';
  readonly value: number;
  /** Always > 0. A fitted factor with no sample is a contradiction. */
  readonly sampleSize: number;
  readonly prior: number;
}

/** Set by a person, attributed. Beats a fit until the next fit supersedes it. */
export interface HumanFactor {
  readonly kind: 'human';
  readonly value: number;
  readonly setBy: string;
  readonly prior: number;
}

export type LearnedFactorState = PriorFactor | FittedFactor | HumanFactor;

/** The multiplicative factors' prior. Neutral means "changes nothing". */
export const NEUTRAL_PRIOR = 1;
/** Last-mile is additive minutes, so its prior is zero added minutes. */
export const ADDITIVE_PRIOR = 0;

export function priorFactor(prior: number): PriorFactor {
  return { kind: 'prior', prior };
}

/**
 * Build a fitted factor. REFUSES a zero sample rather than producing a fitted
 * factor that is secretly a prior — which is the whole defect this file exists
 * to make impossible.
 */
export function fittedFactor(input: { value: number; sampleSize: number; prior: number }): FittedFactor | PriorFactor {
  if (!Number.isFinite(input.value) || !Number.isFinite(input.sampleSize) || input.sampleSize <= 0) {
    return priorFactor(input.prior);
  }
  return { kind: 'fitted', value: input.value, sampleSize: input.sampleSize, prior: input.prior };
}

export function humanFactor(input: { value: number; setBy: string; prior: number }): HumanFactor | PriorFactor {
  if (!Number.isFinite(input.value)) return priorFactor(input.prior);
  return { kind: 'human', value: input.value, setBy: input.setBy, prior: input.prior };
}

/** The number the model uses. A prior contributes its prior, nothing more. */
export function factorValue(f: LearnedFactorState): number {
  return f.kind === 'prior' ? f.prior : f.value;
}

/** Sample size, which is ZERO for a prior and for a human override. */
export function factorSampleSize(f: LearnedFactorState): number {
  return f.kind === 'fitted' ? f.sampleSize : 0;
}

/**
 * How the factor is shown in admin, in an export, and in a report.
 *
 * The rule the brief sets: "A factor sitting at 1.0 because nothing has been
 * learned must read differently from one fitted to 1.0 by evidence. Never let
 * the display collapse them." So a prior does not render a number at all — it
 * renders the absence, which is the true statement.
 */
export interface FactorDisplay {
  /** Machine-readable, for exports and the API. */
  state: 'not_learned' | 'fitted' | 'set_by_hand';
  /** NULL for a prior. There is no learned value to show. */
  learnedValue: number | null;
  /** What the model actually used, which a prior does have. */
  effectiveValue: number;
  sampleSize: number;
  /** One phrase an operator can read without training. */
  label: string;
}

export function describeFactor(f: LearnedFactorState): FactorDisplay {
  if (f.kind === 'prior') {
    return {
      state: 'not_learned',
      learnedValue: null,
      effectiveValue: f.prior,
      sampleSize: 0,
      label: 'Not learned yet — no deliveries to measure',
    };
  }
  if (f.kind === 'human') {
    return {
      state: 'set_by_hand',
      learnedValue: f.value,
      effectiveValue: f.value,
      sampleSize: 0,
      label: `Set by hand (${f.setBy})`,
    };
  }
  return {
    state: 'fitted',
    learnedValue: f.value,
    effectiveValue: f.value,
    sampleSize: f.sampleSize,
    label: `Measured from ${f.sampleSize} deliver${f.sampleSize === 1 ? 'y' : 'ies'}`,
  };
}

/**
 * Read a stored row into a state, refusing the contradiction the database can
 * still express: `origin='fitted'` with `sample_size=0`.
 *
 * The DB constraint allows it (sample_size >= 0), so this is where it dies. A
 * row like that is a bug in whatever wrote it, and treating it as a prior is
 * both the safe reading and the true one — nothing was learned.
 */
export function factorFromRow(row: {
  origin: string;
  value: number | string | null;
  sampleSize: number | null;
  setBy?: string | null;
}, prior: number): LearnedFactorState {
  const value = row.value === null ? Number.NaN : Number(row.value);
  const n = row.sampleSize ?? 0;
  if (row.origin === 'human') return humanFactor({ value, setBy: row.setBy ?? 'unknown', prior });
  if (row.origin === 'fitted') return fittedFactor({ value, sampleSize: n, prior });
  return priorFactor(prior);
}

/** The four factor kinds the model reads, with their correct priors. */
export const FACTOR_PRIORS = {
  corridor_factor: NEUTRAL_PRIOR,
  hour_factor: NEUTRAL_PRIOR,
  detour_factor: NEUTRAL_PRIOR,
  last_mile_minutes: ADDITIVE_PRIOR,
} as const;

export type FactorKind = keyof typeof FACTOR_PRIORS;
export const FACTOR_KINDS = Object.keys(FACTOR_PRIORS) as FactorKind[];
