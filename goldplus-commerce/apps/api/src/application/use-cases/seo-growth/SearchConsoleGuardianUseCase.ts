import {
  assessFreshness,
  assessMateriality,
  advanceHysteresis,
  decideAutonomy,
  checkBudget,
  evaluateCircuit,
  idempotencyKey,
  decideNotification,
  GUARDIAN_POLICY_VERSION,
  DEFAULT_KILL_SWITCHES,
  type FreshnessAssessment,
  type KillSwitches,
  type ChangeBudget,
  type MaterialityThresholds,
  type SignalState,
  type NotifiableEvent,
  type CircuitState,
} from './SeoGuardianPolicy';

/**
 * The six-hourly Search Console Guardian.
 *
 * It orchestrates the decision core over ports, so the whole run — including
 * every refusal — is provable with fakes. The agent's job is as much to decline
 * to act as to act: a run that ends "no material change, no action, no email"
 * is the expected steady state, not a failure.
 *
 * It owns no sensing of its own. GSC collection already exists
 * (SyncGscPerformanceUseCase); this consumes what that stored.
 */

export const GUARDIAN_AGENT = 'SEARCH_CONSOLE_GUARDIAN';

export interface GuardianEntityWindow {
  /** Page or query the window describes. */
  entity: string;
  baselineClicks: number;
  currentClicks: number;
  commerciallyImportant?: boolean;
}

export interface GuardianStoredSignal {
  id: string;
  state: SignalState;
  consecutiveObservations: number;
  alertId: string | null;
}

export interface GuardianPolicySnapshot {
  killSwitches: KillSwitches;
  changeBudget?: ChangeBudget;
  materiality?: MaterialityThresholds;
  autonomyByClass: Record<string, { earnedLevel: 0 | 1 | 2 | 3 | 4; canaryComplete: boolean }>;
}

export interface GuardianPorts {
  /** Newest settled source date we hold, or null. */
  latestSourceDate(): Promise<string | null>;
  /** Windows to evaluate — already aggregated by the caller/repository. */
  entityWindows(): Promise<GuardianEntityWindow[]>;
  loadPolicy(): Promise<GuardianPolicySnapshot>;
  loadSignal(key: string): Promise<GuardianStoredSignal | null>;
  saveSignal(input: {
    key: string;
    entity: string;
    changeType: string;
    state: SignalState;
    consecutiveObservations: number;
    presentNow: boolean;
    baselineValue: number;
    currentValue: number;
    relativeChange: number | null;
    absoluteChange: number;
    materiality: string;
    commerciallyImportant: boolean;
  }): Promise<{ id: string }>;
  /** Reuses the EXISTING seo_alerts table; dedupe_key is the idempotency key. */
  openOrUpdateIncident(input: {
    dedupeKey: string; severity: 'CRITICAL' | 'HIGH' | 'INFO'; kind: string; message: string;
  }): Promise<{ id: string; created: boolean }>;
  resolveIncident(dedupeKey: string): Promise<void>;
  recordAction(input: {
    runId: string; signalId: string | null; key: string; remediationClass: string; tier: string;
    mode: string | null; decision: 'ALLOWED' | 'DENIED'; decisionReason: string; entity: string; proposedUrls: number;
  }): Promise<void>;
  startRun(agent: string): Promise<{ runId: string } | null>;
  finishRun(input: {
    runId: string; status: 'COMPLETED' | 'FAILED'; freshness: FreshnessAssessment; latestSourceDate: string | null;
    signalsEvaluated: number; materialChanges: number; incidentsOpened: number;
    actionsAttempted: number; actionsFailed: number; circuitState: CircuitState; circuitReasons: string[];
    notificationSent: boolean; notificationEvents: NotifiableEvent[]; error?: string;
  }): Promise<void>;
  /** Providers report abnormality; the guardian does not guess it. */
  providerHealth(): Promise<{ abnormal: boolean; authChanged: boolean }>;
  indexableInventory(): Promise<number>;
  recentFalsePositiveRate(): Promise<number | null>;
  sendAggregatedNotification(input: {
    events: NotifiableEvent[]; runId: string; summary: string;
  }): Promise<{ delivered: boolean; detail?: string }>;
}

export interface GuardianRunResult {
  ran: boolean;
  runId: string | null;
  freshness: FreshnessAssessment | null;
  signalsEvaluated: number;
  materialChanges: number;
  incidentsOpened: number;
  actionsAttempted: number;
  circuitState: CircuitState;
  notificationSent: boolean;
  events: NotifiableEvent[];
  /** Human-readable summary of why the run concluded as it did. */
  summary: string;
}

const CLICK_DROP = 'CLICK_DROP';
const REMEDIATION_CLASS = 'GSC_CLICK_DROP_INVESTIGATION';

export class SearchConsoleGuardianUseCase {
  constructor(
    private readonly ports: GuardianPorts,
    private readonly property = 'sc-domain:shopgoldplus.com',
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<GuardianRunResult> {
    // A missed lease is not a failure — it means another worker holds the run.
    const started = await this.ports.startRun(GUARDIAN_AGENT);
    if (!started) {
      return {
        ran: false, runId: null, freshness: null, signalsEvaluated: 0, materialChanges: 0,
        incidentsOpened: 0, actionsAttempted: 0, circuitState: 'CLOSED', notificationSent: false,
        events: [], summary: 'Another Guardian run holds the lease; this invocation stood down.',
      };
    }
    const runId = started.runId;
    const events: NotifiableEvent[] = [];

    try {
      const latestSourceDate = await this.ports.latestSourceDate();
      const freshness = assessFreshness({ latestSourceDate, observedAt: this.now() });
      if (freshness.state === 'STALE') events.push('SOURCE_STALE');

      const [policy, health, inventory, fpRate] = await Promise.all([
        this.ports.loadPolicy(),
        this.ports.providerHealth(),
        this.ports.indexableInventory(),
        this.ports.recentFalsePositiveRate(),
      ]);
      if (health.authChanged) events.push('AUTH_CHANGED');
      if (health.abnormal) events.push('PROVIDER_DEGRADED');

      const circuit = evaluateCircuit({
        providerResponseAbnormal: health.abnormal,
        freshness: freshness.state,
        authChangedUnexpectedly: health.authChanged,
        proposedWritesExceedBudget: false,
        consecutiveVerificationFailures: 0,
        falsePositiveRate: fpRate,
        implausibleMassChange: false,
      });
      if (circuit.state === 'OPEN') events.push('CIRCUIT_OPENED');

      const windows = await this.ports.entityWindows();
      let materialChanges = 0;
      let incidentsOpened = 0;
      let actionsAttempted = 0;
      let actionsFailed = 0;

      for (const w of windows) {
        const materiality = assessMateriality({
          baselineClicks: w.baselineClicks,
          currentClicks: w.currentClicks,
          comparisonValid: freshness.comparisonValid,
          thresholds: policy.materiality,
          commerciallyImportant: w.commerciallyImportant,
        });

        // Only a material DROP is a condition. A material rise is recorded as
        // evidence but never opens an incident.
        const presentNow = materiality.verdict === 'MATERIAL' && materiality.direction === 'DOWN';

        const key = idempotencyKey({
          provider: 'GSC',
          property: this.property,
          entity: w.entity,
          changeType: CLICK_DROP,
          sourceStateVersion: latestSourceDate ?? 'none',
          action: 'OPEN_INCIDENT',
          policyVersion: GUARDIAN_POLICY_VERSION,
        });

        const stored = await this.ports.loadSignal(key);
        const advanced = advanceHysteresis({
          previousState: stored?.state ?? null,
          presentNow,
          consecutiveObservations: stored?.consecutiveObservations ?? 0,
        });

        const saved = await this.ports.saveSignal({
          key,
          entity: w.entity,
          changeType: CLICK_DROP,
          state: advanced.state,
          consecutiveObservations: presentNow ? (stored?.consecutiveObservations ?? 0) + 1 : 0,
          presentNow,
          baselineValue: w.baselineClicks,
          currentValue: w.currentClicks,
          relativeChange: materiality.relativeChange,
          absoluteChange: materiality.absoluteChange,
          materiality: materiality.verdict,
          commerciallyImportant: w.commerciallyImportant === true,
        });

        if (presentNow) materialChanges += 1;

        // Incident only on a NOTABLE transition into an actionable state —
        // never on every run of an already-open problem.
        if (advanced.actionable && advanced.notableTransition) {
          const incident = await this.ports.openOrUpdateIncident({
            dedupeKey: key,
            severity: w.commerciallyImportant ? 'CRITICAL' : 'HIGH',
            kind: CLICK_DROP,
            message:
              `${w.entity}: clicks ${w.baselineClicks} → ${w.currentClicks} ` +
              `(${materiality.relativeChange === null ? 'n/a' : `${(materiality.relativeChange * 100).toFixed(1)}%`}). ${materiality.reason}`,
          });
          if (incident.created) {
            incidentsOpened += 1;
            events.push('INCIDENT_OPENED');
          }
        }

        if (advanced.state === 'RECOVERED' && advanced.notableTransition) {
          await this.ports.resolveIncident(key);
          events.push('RECOVERY_VERIFIED');
        }

        // Decide whether the agent may act. At this maturity the only
        // remediation class is an investigation work item (Tier 1), and the
        // default policy is observe-only — so this normally DENIES, on purpose.
        const cls = policy.autonomyByClass[REMEDIATION_CLASS] ?? { earnedLevel: 0 as const, canaryComplete: false };
        const budget = checkBudget({ proposedUrls: 1, indexableInventory: inventory, budget: policy.changeBudget });
        const decision = decideAutonomy({
          tier: 'TIER_1_INTERNAL',
          earnedLevel: cls.earnedLevel,
          killSwitches: policy.killSwitches,
          circuitState: circuit.state,
          budget,
          canaryComplete: cls.canaryComplete,
          signalActionable: advanced.actionable,
        });

        await this.ports.recordAction({
          runId,
          signalId: saved.id,
          key: `${key}::act`,
          remediationClass: REMEDIATION_CLASS,
          tier: 'TIER_1_INTERNAL',
          mode: decision.allowed ? decision.mode : null,
          decision: decision.allowed ? 'ALLOWED' : 'DENIED',
          decisionReason: decision.allowed ? `Permitted in ${decision.mode} mode.` : decision.reason,
          entity: w.entity,
          proposedUrls: 1,
        });

        if (decision.allowed) {
          actionsAttempted += 1;
          events.push('SAFE_ACTION_EXECUTED');
        }
      }

      if (materialChanges > 0) events.push('MATERIAL_CHANGE');

      const notify = decideNotification({ events, killSwitches: policy.killSwitches });
      const summary = this.summarise({
        freshness, windows: windows.length, materialChanges, incidentsOpened, actionsAttempted, circuit: circuit.state,
      });

      let notificationSent = false;
      if (notify.send) {
        const sent = await this.ports.sendAggregatedNotification({ events: notify.events, runId, summary });
        notificationSent = sent.delivered;
      }

      await this.ports.finishRun({
        runId, status: 'COMPLETED', freshness, latestSourceDate,
        signalsEvaluated: windows.length, materialChanges, incidentsOpened,
        actionsAttempted, actionsFailed, circuitState: circuit.state, circuitReasons: circuit.reasons,
        notificationSent, notificationEvents: notify.events,
      });

      return {
        ran: true, runId, freshness, signalsEvaluated: windows.length, materialChanges,
        incidentsOpened, actionsAttempted, circuitState: circuit.state,
        notificationSent, events: notify.events, summary,
      };
    } catch (err: any) {
      const message = String(err?.message ?? err).slice(0, 500);
      await this.ports.finishRun({
        runId, status: 'FAILED',
        freshness: { state: 'UNKNOWN', lagDays: null, comparisonValid: false, reason: 'Run failed before assessment completed.' },
        latestSourceDate: null, signalsEvaluated: 0, materialChanges: 0, incidentsOpened: 0,
        actionsAttempted: 0, actionsFailed: 1, circuitState: 'OPEN', circuitReasons: ['Guardian run threw.'],
        notificationSent: false, notificationEvents: ['AGENT_FAILED'], error: message,
      }).catch(() => undefined);
      return {
        ran: true, runId, freshness: null, signalsEvaluated: 0, materialChanges: 0, incidentsOpened: 0,
        actionsAttempted: 0, circuitState: 'OPEN', notificationSent: false, events: ['AGENT_FAILED'],
        summary: `Guardian run failed: ${message}`,
      };
    }
  }

  private summarise(i: {
    freshness: FreshnessAssessment; windows: number; materialChanges: number;
    incidentsOpened: number; actionsAttempted: number; circuit: CircuitState;
  }): string {
    if (!i.freshness.comparisonValid) {
      return `No comparison drawn: ${i.freshness.reason} ${i.windows} entities observed; nothing was classified as a change.`;
    }
    if (i.materialChanges === 0) {
      return `${i.windows} entities compared; no material change. No incident, no action, no notification.`;
    }
    return (
      `${i.windows} entities compared; ${i.materialChanges} material change(s), ` +
      `${i.incidentsOpened} incident(s) opened, ${i.actionsAttempted} action(s) permitted. Circuit ${i.circuit}.`
    );
  }
}
