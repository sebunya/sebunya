/**
 * Guardian readiness: the provider gate and the baseline lifecycle.
 *
 * Two problems this solves, both of which would otherwise make a six-hourly
 * agent actively harmful:
 *
 * 1. The schedule may legitimately be registered BEFORE Search Console has
 *    credentials. A run in that state must be silent and cheap — it must not
 *    open a "GSC missing" incident every six hours, nor create duplicate work
 *    items, nor attempt collection. The moment credentials arrive through the
 *    existing integrations control plane, the next scheduled run picks up
 *    automatically. No redeploy to supply a credential.
 *
 * 2. An agent with no history has no idea what normal looks like. Rather than
 *    idling for a week, it establishes context from Search Console's own
 *    historical windows (BACKFILL) while a short live sequence confirms the
 *    live pipeline (BASELINE_CAPTURE -> BASELINE_CONFIRMATION -> ACTIVE).
 *
 * Pure. No database, no provider, no ambient clock.
 */

// ── Provider readiness ──────────────────────────────────────────────────────

export const PROVIDER_READINESS = [
  'CONNECTED', 'WAITING_FOR_CREDENTIAL', 'AUTHORIZATION_REQUIRED', 'DISABLED', 'DEGRADED', 'UNKNOWN',
] as const;
export type ProviderReadiness = (typeof PROVIDER_READINESS)[number];

export interface ProviderStatusInput {
  /** Connection row status from the integrations control plane, if any. */
  connectionStatus: string | null;
  hasActiveCredential: boolean;
  /** Whether a required property/site reference has been selected. */
  propertyConfigured: boolean;
}

export interface ProviderGateResult {
  readiness: ProviderReadiness;
  /** May the run collect and evaluate at all? */
  proceed: boolean;
  /**
   * A gated run is recorded but must stay silent — no incident, no work item,
   * no notification. Six-hourly noise about a known-absent credential is the
   * fastest way to make an operator stop reading the agent's output.
   */
  silent: boolean;
  reason: string;
}

export function evaluateProviderGate(input: ProviderStatusInput): ProviderGateResult {
  if (!input.connectionStatus) {
    return {
      readiness: 'WAITING_FOR_CREDENTIAL',
      proceed: false,
      silent: true,
      reason: 'No Search Console connection exists yet. Upload the service-account JSON in /admin/seo/integrations; the next scheduled run will pick it up.',
    };
  }
  if (input.connectionStatus === 'DISABLED') {
    return { readiness: 'DISABLED', proceed: false, silent: true, reason: 'The Search Console connection is disabled.' };
  }
  if (!input.hasActiveCredential) {
    return {
      readiness: 'WAITING_FOR_CREDENTIAL',
      proceed: false,
      silent: true,
      reason: 'The connection exists but holds no active credential.',
    };
  }
  if (input.connectionStatus === 'AUTHORIZATION_REQUIRED' || input.connectionStatus === 'AUTH_EXPIRED') {
    // NOT silent: a credential that has expired is a real operational event.
    return {
      readiness: 'AUTHORIZATION_REQUIRED',
      proceed: false,
      silent: false,
      reason: 'The stored credential is no longer authorised for this property.',
    };
  }
  if (!input.propertyConfigured) {
    return {
      readiness: 'UNKNOWN',
      proceed: false,
      silent: true,
      reason: 'No Search Console property has been selected for this connection yet.',
    };
  }
  if (['ERROR', 'PROVIDER_ERROR', 'RATE_LIMITED'].includes(input.connectionStatus)) {
    return { readiness: 'DEGRADED', proceed: false, silent: false, reason: `The provider is ${input.connectionStatus}.` };
  }
  if (input.connectionStatus === 'CONNECTED' || input.connectionStatus === 'READY') {
    return { readiness: 'CONNECTED', proceed: true, silent: false, reason: 'Search Console is connected and a property is selected.' };
  }
  // CONFIGURING and anything else: set up but not yet proven by a real test.
  return {
    readiness: 'UNKNOWN',
    proceed: false,
    silent: true,
    reason: `The connection is ${input.connectionStatus}; it has not yet passed a staged test.`,
  };
}

// ── Baseline lifecycle ──────────────────────────────────────────────────────

export const BASELINE_PHASES = [
  'NO_PROVIDER', 'BACKFILL_PENDING', 'BACKFILL_COMPLETE',
  'BASELINE_CAPTURE', 'BASELINE_CONFIRMATION', 'OBSERVE_ONLY_ACTIVE',
] as const;
export type BaselinePhase = (typeof BASELINE_PHASES)[number];

export interface BaselineStateInput {
  providerConnected: boolean;
  historicalBackfillComplete: boolean;
  /** Live runs that produced a VALID comparable observation. */
  validLiveRuns: number;
}

export interface BaselinePhaseResult {
  phase: BaselinePhase;
  /** May this run classify changes and open incidents? */
  mayClassify: boolean;
  /** May this run run the historical backfill? */
  shouldBackfill: boolean;
  reason: string;
}

/** Live runs required before classification is trusted. */
export const LIVE_RUNS_BEFORE_ACTIVE = 2;

export function resolveBaselinePhase(input: BaselineStateInput): BaselinePhaseResult {
  if (!input.providerConnected) {
    return { phase: 'NO_PROVIDER', mayClassify: false, shouldBackfill: false, reason: 'No provider is connected.' };
  }
  if (!input.historicalBackfillComplete) {
    return {
      phase: 'BACKFILL_PENDING',
      mayClassify: false,
      shouldBackfill: true,
      // Context first. Classifying before we know what normal looks like is how
      // an agent alerts on ordinary weekly seasonality.
      reason: 'Historical Search Console context has not been established yet.',
    };
  }
  if (input.validLiveRuns === 0) {
    return { phase: 'BASELINE_CAPTURE', mayClassify: false, shouldBackfill: false, reason: 'Capturing the first live observation.' };
  }
  if (input.validLiveRuns < LIVE_RUNS_BEFORE_ACTIVE) {
    return { phase: 'BASELINE_CONFIRMATION', mayClassify: false, shouldBackfill: false, reason: 'Confirming the live pipeline against the historical baseline.' };
  }
  return {
    phase: 'OBSERVE_ONLY_ACTIVE',
    mayClassify: true,
    shouldBackfill: false,
    reason: 'Historical context established and the live pipeline confirmed; classification is active in observe-only mode.',
  };
}

// ── Backfill safety ─────────────────────────────────────────────────────────

export interface BackfillWindow {
  label: string;
  startDate: string;
  endDate: string;
}

/**
 * Comparable historical windows, all ending before the settle horizon so every
 * window is complete. Returns [] when the provider has no settled data.
 */
export function backfillWindows(latestSettledDate: string | null): BackfillWindow[] {
  if (!latestSettledDate) return [];
  const end = new Date(`${latestSettledDate}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return [];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const minus = (days: number) => new Date(end.getTime() - days * 86_400_000);
  return [
    { label: 'LAST_7', startDate: iso(minus(6)), endDate: iso(end) },
    { label: 'PREVIOUS_7', startDate: iso(minus(13)), endDate: iso(minus(7)) },
    { label: 'LAST_28', startDate: iso(minus(27)), endDate: iso(end) },
    { label: 'PREVIOUS_28', startDate: iso(minus(55)), endDate: iso(minus(28)) },
  ];
}

export interface BackfillConstraints {
  mayNotify: boolean;
  mayMutateExternally: boolean;
  mayOpenIncidents: boolean;
  mayOverwriteLiveBaseline: boolean;
}

/**
 * Backfill is archaeology, not monitoring. A drop that happened three weeks ago
 * is context; it is not an incident happening now, and treating it as one would
 * flood the operator on day one.
 */
export const BACKFILL_CONSTRAINTS: BackfillConstraints = {
  mayNotify: false,
  mayMutateExternally: false,
  mayOpenIncidents: false,
  mayOverwriteLiveBaseline: false,
};

// ── Level-1 readiness ───────────────────────────────────────────────────────

export interface Level1ReadinessInput {
  sourceFreshnessStable: boolean;
  baselineStable: boolean;
  policyStable: boolean;
  idempotencyProven: boolean;
  circuitGreen: boolean;
  changeBudgetGreen: boolean;
  incidentDedupGreen: boolean;
  validLiveRuns: number;
}

export interface Level1Readiness {
  ready: boolean;
  missing: string[];
}

/** Minimum live observations before a class may be promoted off Level 0. */
export const RUNS_BEFORE_LEVEL_1 = 4;

export function assessLevel1Readiness(i: Level1ReadinessInput): Level1Readiness {
  const missing: string[] = [];
  if (!i.sourceFreshnessStable) missing.push('SOURCE_FRESHNESS_STABLE');
  if (!i.baselineStable) missing.push('BASELINE_STABLE');
  if (!i.policyStable) missing.push('POLICY_STABLE');
  if (!i.idempotencyProven) missing.push('IDEMPOTENCY_PROVEN');
  if (!i.circuitGreen) missing.push('CIRCUIT_BREAKER_GREEN');
  if (!i.changeBudgetGreen) missing.push('CHANGE_BUDGET_GREEN');
  if (!i.incidentDedupGreen) missing.push('INCIDENT_DEDUP_GREEN');
  if (i.validLiveRuns < RUNS_BEFORE_LEVEL_1) missing.push(`VALID_LIVE_RUNS>=${RUNS_BEFORE_LEVEL_1}`);
  return { ready: missing.length === 0, missing };
}
