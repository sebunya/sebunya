/**
 * Search Console Guardian — the decision core.
 *
 * GoldPlus already has strong SENSORS (GSC sync, crawler, link graph, render
 * diff, server logs). What it lacked was anything that decides: whether an
 * observation is even comparable, whether a change matters, whether it has
 * persisted, whether the agent may act, and how much it may change.
 *
 * Everything here is PURE. No database, no provider, no clock beyond what the
 * caller passes in. That is deliberate: the rules that decide whether a live
 * site gets mutated must be exhaustively testable without infrastructure.
 *
 * The governing bias throughout is RESTRAINT. A run that concludes
 * "no material change, no action, no email" is a successful run.
 */

// ── Source freshness ────────────────────────────────────────────────────────

/**
 * Search Console back-fills for ~2-3 days. Comparing a partial current window
 * against a complete previous one manufactures a "traffic collapse" every
 * single run. Freshness is therefore a first-class input, not a footnote.
 */
export const FRESHNESS_STATES = ['COMPLETE', 'PARTIAL', 'DELAYED', 'STALE', 'UNKNOWN'] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

/** GSC finalises a day's data after roughly this long. */
export const GSC_SETTLE_DAYS = 3;
/** Beyond this with no new data, the feed itself is the problem. */
export const GSC_STALE_DAYS = 5;

export interface FreshnessInput {
  /** Latest date present in our store (YYYY-MM-DD), or null when we hold none. */
  latestSourceDate: string | null;
  /** The moment we are evaluating at (injected — never Date.now() in here). */
  observedAt: Date;
}

export interface FreshnessAssessment {
  state: FreshnessState;
  lagDays: number | null;
  /** Whether a period-over-period comparison may be drawn at all. */
  comparisonValid: boolean;
  reason: string;
}

const dayDiff = (a: Date, b: Date): number =>
  Math.floor((a.getTime() - b.getTime()) / 86_400_000);

export function assessFreshness(input: FreshnessInput): FreshnessAssessment {
  if (!input.latestSourceDate) {
    return {
      state: 'UNKNOWN',
      lagDays: null,
      comparisonValid: false,
      // NOT "zero clicks". We hold no data; that is ignorance, not a collapse.
      reason: 'No Search Console data is stored yet, so nothing can be compared.',
    };
  }
  const latest = new Date(`${input.latestSourceDate}T00:00:00Z`);
  if (Number.isNaN(latest.getTime())) {
    return { state: 'UNKNOWN', lagDays: null, comparisonValid: false, reason: 'Stored source date is unreadable.' };
  }
  const lagDays = dayDiff(input.observedAt, latest);

  if (lagDays > GSC_STALE_DAYS) {
    return {
      state: 'STALE',
      lagDays,
      comparisonValid: false,
      reason: `The newest Search Console data is ${lagDays} days old; the feed itself looks broken, so a drop cannot be attributed to the site.`,
    };
  }
  if (lagDays > GSC_SETTLE_DAYS) {
    return {
      state: 'DELAYED',
      lagDays,
      comparisonValid: false,
      reason: `Search Console is ${lagDays} days behind its usual ${GSC_SETTLE_DAYS}-day settle; treat gaps as provider latency.`,
    };
  }
  if (lagDays > 0) {
    return {
      state: 'PARTIAL',
      lagDays,
      // The crucial rule: partial data is usable for TRENDS but never for a
      // period-over-period verdict, because the current window is still filling.
      comparisonValid: false,
      reason: `The most recent ${lagDays} day(s) are still settling; a period-over-period comparison would compare a partial window against a complete one.`,
    };
  }
  return { state: 'COMPLETE', lagDays, comparisonValid: true, reason: 'Source data is settled and comparable.' };
}

// ── Materiality ─────────────────────────────────────────────────────────────

/**
 * A 50% loss on 2 clicks is noise. A 20% loss on 5,000 qualified clicks is a
 * business event. Percentage alone is the single most common way an SEO alerting
 * system destroys its own credibility.
 */
export const MATERIALITY_VERDICTS = ['MATERIAL', 'IMMATERIAL', 'INSUFFICIENT_BASELINE', 'NOT_COMPARABLE'] as const;
export type MaterialityVerdict = (typeof MATERIALITY_VERDICTS)[number];

export interface MaterialityThresholds {
  /** Below this baseline volume nothing is ever material — the sample is too small. */
  minBaselineClicks: number;
  /** Relative move required (0.25 = 25%). */
  minRelativeChange: number;
  /** Absolute move required, so huge pages need a real number of clicks lost. */
  minAbsoluteChange: number;
}

/** Governed defaults. Weights belong to configuration, not to a hard-coded formula. */
export const DEFAULT_MATERIALITY: MaterialityThresholds = {
  minBaselineClicks: 25,
  minRelativeChange: 0.2,
  minAbsoluteChange: 10,
};

export interface MaterialityInput {
  baselineClicks: number;
  currentClicks: number;
  comparisonValid: boolean;
  thresholds?: MaterialityThresholds;
  /** Commercially important entities earn a lower bar — but never a zero bar. */
  commerciallyImportant?: boolean;
}

export interface MaterialityAssessment {
  verdict: MaterialityVerdict;
  relativeChange: number | null;
  absoluteChange: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  reason: string;
}

export function assessMateriality(input: MaterialityInput): MaterialityAssessment {
  const t = input.thresholds ?? DEFAULT_MATERIALITY;
  const absoluteChange = input.currentClicks - input.baselineClicks;
  const direction = absoluteChange > 0 ? 'UP' : absoluteChange < 0 ? 'DOWN' : 'FLAT';

  if (!input.comparisonValid) {
    return {
      verdict: 'NOT_COMPARABLE',
      relativeChange: null,
      absoluteChange,
      direction,
      reason: 'The two periods are not comparable, so no change can be called material.',
    };
  }
  if (input.baselineClicks < t.minBaselineClicks) {
    return {
      verdict: 'INSUFFICIENT_BASELINE',
      relativeChange: input.baselineClicks > 0 ? absoluteChange / input.baselineClicks : null,
      absoluteChange,
      direction,
      reason: `Baseline of ${input.baselineClicks} clicks is below the ${t.minBaselineClicks}-click floor; percentage swings here are noise.`,
    };
  }

  const relativeChange = absoluteChange / input.baselineClicks;
  // A commercially important entity halves the bar. It does NOT remove it:
  // importance changes what is worth acting on, never what is true.
  const relBar = input.commerciallyImportant ? t.minRelativeChange / 2 : t.minRelativeChange;
  const absBar = input.commerciallyImportant ? Math.ceil(t.minAbsoluteChange / 2) : t.minAbsoluteChange;

  const material = Math.abs(relativeChange) >= relBar && Math.abs(absoluteChange) >= absBar;
  return {
    verdict: material ? 'MATERIAL' : 'IMMATERIAL',
    relativeChange,
    absoluteChange,
    direction,
    reason: material
      ? `${(relativeChange * 100).toFixed(1)}% and ${absoluteChange} clicks both clear the bar (${(relBar * 100).toFixed(0)}% / ${absBar}).`
      : `Change of ${(relativeChange * 100).toFixed(1)}% / ${absoluteChange} clicks does not clear both bars.`,
  };
}

// ── Hysteresis ──────────────────────────────────────────────────────────────

/**
 * One bad reading is not an incident. Requiring persistence is what stops the
 * agent flapping an incident open and closed every six hours.
 */
export const SIGNAL_STATES = [
  'FIRST_OBSERVED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'ONGOING', 'RECOVERING', 'RECOVERED',
] as const;
export type SignalState = (typeof SIGNAL_STATES)[number];

/** Consecutive material observations before a signal is CONFIRMED. */
export const CONFIRMATION_RUNS = 2;

export interface HysteresisInput {
  previousState: SignalState | null;
  /** Is the condition present in THIS run? */
  presentNow: boolean;
  consecutiveObservations: number;
  /**
   * Critical technical states (a site-wide noindex, robots blocking
   * everything) may skip persistence — waiting six more hours to confirm a
   * deindexing event is itself the harm.
   */
  criticalTechnical?: boolean;
}

export interface HysteresisResult {
  state: SignalState;
  /** Only a CONFIRMED/ONGOING signal may open an incident or drive an action. */
  actionable: boolean;
  /** True only on the transition INTO a state worth telling a human about. */
  notableTransition: boolean;
}

export function advanceHysteresis(input: HysteresisInput): HysteresisResult {
  const prev = input.previousState;

  if (input.presentNow && input.criticalTechnical) {
    return {
      state: 'CONFIRMED',
      actionable: true,
      notableTransition: prev !== 'CONFIRMED' && prev !== 'ONGOING',
    };
  }

  if (input.presentNow) {
    if (prev === 'CONFIRMED' || prev === 'ONGOING') {
      return { state: 'ONGOING', actionable: true, notableTransition: false };
    }
    if (prev === 'RECOVERING' || prev === 'RECOVERED') {
      // It came back. That IS worth saying.
      return { state: 'CONFIRMED', actionable: true, notableTransition: true };
    }
    const runs = input.consecutiveObservations + 1;
    if (runs >= CONFIRMATION_RUNS) {
      return { state: 'CONFIRMED', actionable: true, notableTransition: true };
    }
    return {
      state: prev === null ? 'FIRST_OBSERVED' : 'PENDING_CONFIRMATION',
      actionable: false,
      notableTransition: false,
    };
  }

  // Condition absent this run.
  if (prev === 'CONFIRMED' || prev === 'ONGOING') {
    // One clean run is not a recovery — it is a candidate recovery.
    return { state: 'RECOVERING', actionable: false, notableTransition: false };
  }
  if (prev === 'RECOVERING') {
    return { state: 'RECOVERED', actionable: false, notableTransition: true };
  }
  return { state: prev === null ? 'FIRST_OBSERVED' : 'RECOVERED', actionable: false, notableTransition: false };
}

// ── Autonomy ────────────────────────────────────────────────────────────────

export const AUTONOMY_LEVELS = [0, 1, 2, 3, 4] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const ACTION_TIERS = ['TIER_0_OBSERVE', 'TIER_1_INTERNAL', 'TIER_2_REVERSIBLE', 'TIER_3_STRUCTURAL', 'TIER_4_DESTRUCTIVE'] as const;
export type ActionTier = (typeof ACTION_TIERS)[number];

/** Minimum earned autonomy level before a tier may execute without a human. */
const TIER_MIN_LEVEL: Record<ActionTier, AutonomyLevel | null> = {
  TIER_0_OBSERVE: 0,
  TIER_1_INTERNAL: 1,
  TIER_2_REVERSIBLE: 3,
  TIER_3_STRUCTURAL: 4,
  // Never. DNS, ownership, mass redirects, mass noindex, bulk deletion.
  TIER_4_DESTRUCTIVE: null,
};

export interface AutonomyDecisionInput {
  tier: ActionTier;
  /** Level this remediation CLASS has earned, not a global setting. */
  earnedLevel: AutonomyLevel;
  killSwitches: KillSwitches;
  circuitState: CircuitState;
  budget: BudgetVerdict;
  /** A class must canary before it may run at scale. */
  canaryComplete: boolean;
  signalActionable: boolean;
}

export type AutonomyOutcome =
  | { allowed: true; mode: 'CANARY' | 'FULL' }
  | { allowed: false; code: string; reason: string };

export function decideAutonomy(input: AutonomyDecisionInput): AutonomyOutcome {
  if (!input.killSwitches.organicAgentsEnabled) {
    return { allowed: false, code: 'AGENTS_DISABLED', reason: 'Organic agents are switched off.' };
  }
  if (input.killSwitches.observeOnlyMode) {
    return { allowed: false, code: 'OBSERVE_ONLY', reason: 'The system is in observe-only mode.' };
  }
  if (!input.signalActionable) {
    return { allowed: false, code: 'SIGNAL_NOT_CONFIRMED', reason: 'The signal has not persisted long enough to act on.' };
  }
  if (input.circuitState !== 'CLOSED' && input.circuitState !== 'HALF_OPEN') {
    return { allowed: false, code: 'CIRCUIT_OPEN', reason: 'The safety circuit is open; observation continues but writes are stopped.' };
  }
  if (input.tier !== 'TIER_0_OBSERVE' && !input.killSwitches.autonomousWritesEnabled) {
    return { allowed: false, code: 'WRITES_DISABLED', reason: 'Autonomous writes are switched off.' };
  }

  const min = TIER_MIN_LEVEL[input.tier];
  if (min === null) {
    return {
      allowed: false,
      code: 'TIER_NEVER_AUTONOMOUS',
      reason: 'This action class is destructive and is never performed autonomously.',
    };
  }
  if (input.earnedLevel < min) {
    return {
      allowed: false,
      code: 'INSUFFICIENT_AUTONOMY',
      reason: `This class is at level ${input.earnedLevel}; level ${min} is required for ${input.tier}.`,
    };
  }
  if (!input.budget.withinBudget) {
    return { allowed: false, code: 'BUDGET_EXCEEDED', reason: input.budget.reason };
  }
  // A brand-new class always starts on a canary, whatever level it holds.
  if (!input.canaryComplete) return { allowed: true, mode: 'CANARY' };
  if (input.circuitState === 'HALF_OPEN') return { allowed: true, mode: 'CANARY' };
  return { allowed: true, mode: 'FULL' };
}

// ── Kill switches ───────────────────────────────────────────────────────────

export interface KillSwitches {
  organicAgentsEnabled: boolean;
  autonomousWritesEnabled: boolean;
  externalWritesEnabled: boolean;
  contentAutopublishEnabled: boolean;
  emailNotificationsEnabled: boolean;
  observeOnlyMode: boolean;
}

/** Safe by default: observe and recommend, never mutate, until switched on. */
export const DEFAULT_KILL_SWITCHES: KillSwitches = {
  organicAgentsEnabled: true,
  autonomousWritesEnabled: false,
  externalWritesEnabled: false,
  contentAutopublishEnabled: false,
  emailNotificationsEnabled: true,
  observeOnlyMode: true,
};

// ── Blast radius ────────────────────────────────────────────────────────────

export interface ChangeBudget {
  maxExternalWritesPerRun: number;
  maxInternalMutationsPerRun: number;
  maxUrlsPerRemediationClass: number;
  maxPercentOfIndexableInventory: number;
  maxIncidentsPerRun: number;
}

export const DEFAULT_CHANGE_BUDGET: ChangeBudget = {
  maxExternalWritesPerRun: 5,
  maxInternalMutationsPerRun: 200,
  maxUrlsPerRemediationClass: 25,
  maxPercentOfIndexableInventory: 0.05,
  maxIncidentsPerRun: 10,
};

export interface BudgetVerdict {
  withinBudget: boolean;
  reason: string;
}

export function checkBudget(input: {
  proposedUrls: number;
  indexableInventory: number;
  budget?: ChangeBudget;
}): BudgetVerdict {
  const b = input.budget ?? DEFAULT_CHANGE_BUDGET;
  if (input.proposedUrls > b.maxUrlsPerRemediationClass) {
    return {
      withinBudget: false,
      reason: `${input.proposedUrls} URLs exceeds the ${b.maxUrlsPerRemediationClass}-URL cap for a single remediation class.`,
    };
  }
  if (input.indexableInventory > 0) {
    const share = input.proposedUrls / input.indexableInventory;
    if (share > b.maxPercentOfIndexableInventory) {
      // A misfiring classifier must never be able to move a large share of the site.
      return {
        withinBudget: false,
        reason: `${(share * 100).toFixed(1)}% of indexable inventory exceeds the ${(b.maxPercentOfIndexableInventory * 100).toFixed(0)}% ceiling.`,
      };
    }
  }
  return { withinBudget: true, reason: 'Within budget.' };
}

// ── Circuit breaker ─────────────────────────────────────────────────────────

export const CIRCUIT_STATES = ['CLOSED', 'OPEN', 'HALF_OPEN'] as const;
export type CircuitState = (typeof CIRCUIT_STATES)[number];

export interface CircuitInput {
  providerResponseAbnormal: boolean;
  freshness: FreshnessState;
  authChangedUnexpectedly: boolean;
  proposedWritesExceedBudget: boolean;
  consecutiveVerificationFailures: number;
  falsePositiveRate: number | null;
  implausibleMassChange: boolean;
}

export interface CircuitDecision {
  state: CircuitState;
  reasons: string[];
}

export const MAX_VERIFICATION_FAILURES = 3;
export const MAX_FALSE_POSITIVE_RATE = 0.3;

export function evaluateCircuit(input: CircuitInput): CircuitDecision {
  const reasons: string[] = [];
  if (input.providerResponseAbnormal) reasons.push('Provider responses are structurally abnormal.');
  if (input.freshness === 'UNKNOWN' || input.freshness === 'STALE') reasons.push(`Source freshness is ${input.freshness}.`);
  if (input.authChangedUnexpectedly) reasons.push('Provider authorisation changed unexpectedly.');
  if (input.proposedWritesExceedBudget) reasons.push('Proposed writes exceed the configured budget.');
  if (input.implausibleMassChange) reasons.push('An implausible mass state change was observed.');
  if (input.consecutiveVerificationFailures >= MAX_VERIFICATION_FAILURES) {
    reasons.push(`${input.consecutiveVerificationFailures} consecutive verification failures.`);
  }
  if (input.falsePositiveRate !== null && input.falsePositiveRate > MAX_FALSE_POSITIVE_RATE) {
    reasons.push(`False-positive rate ${(input.falsePositiveRate * 100).toFixed(0)}% exceeds the ceiling.`);
  }
  // Observation always continues; only mutation stops.
  return { state: reasons.length > 0 ? 'OPEN' : 'CLOSED', reasons };
}

// ── Idempotency ─────────────────────────────────────────────────────────────

/**
 * The same unresolved condition must not create a duplicate mutation, incident
 * or email every six hours. The key deliberately EXCLUDES the run timestamp and
 * includes the policy version, so a policy change legitimately produces a new
 * key while an unchanged condition does not.
 */
export function idempotencyKey(parts: {
  provider: string;
  property: string;
  entity: string;
  changeType: string;
  sourceStateVersion: string;
  action: string;
  policyVersion: string;
}): string {
  return [
    parts.provider, parts.property, parts.entity, parts.changeType,
    parts.sourceStateVersion, parts.action, parts.policyVersion,
  ]
    .map((p) => String(p ?? '').trim().toLowerCase().replace(/\s+/g, '-'))
    .join('::');
}

// ── Notification policy ─────────────────────────────────────────────────────

export const NOTIFIABLE_EVENTS = [
  'MATERIAL_CHANGE', 'MATERIAL_OPPORTUNITY', 'INCIDENT_OPENED', 'INCIDENT_ESCALATED',
  'SAFE_ACTION_EXECUTED', 'ACTION_FAILED', 'PROVIDER_DEGRADED', 'AUTH_CHANGED',
  'SOURCE_STALE', 'CIRCUIT_OPENED', 'RECOVERY_VERIFIED', 'AGENT_FAILED',
] as const;
export type NotifiableEvent = (typeof NOTIFIABLE_EVENTS)[number];

export interface NotificationDecision {
  send: boolean;
  events: NotifiableEvent[];
  reason: string;
}

/**
 * One run produces at most ONE aggregated message, and only when something
 * meaningful happened. A clean run is silent — that is the point.
 */
export function decideNotification(input: {
  events: NotifiableEvent[];
  killSwitches: KillSwitches;
}): NotificationDecision {
  const events = [...new Set(input.events)].filter((e) => NOTIFIABLE_EVENTS.includes(e));
  if (!input.killSwitches.emailNotificationsEnabled) {
    return { send: false, events, reason: 'Email notifications are switched off.' };
  }
  if (events.length === 0) {
    return { send: false, events, reason: 'Nothing material happened in this run.' };
  }
  return { send: true, events, reason: `${events.length} notifiable event(s) in this run.` };
}

/** The policy version stamped into idempotency keys and evidence. */
export const GUARDIAN_POLICY_VERSION = '1.0.0';
