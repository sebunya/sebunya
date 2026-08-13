import { describe, expect, it } from 'vitest';

import {
  assessFreshness,
  assessMateriality,
  advanceHysteresis,
  decideAutonomy,
  checkBudget,
  evaluateCircuit,
  idempotencyKey,
  decideNotification,
  DEFAULT_KILL_SWITCHES,
  DEFAULT_CHANGE_BUDGET,
  GUARDIAN_POLICY_VERSION,
  type KillSwitches,
  type SignalState,
} from '../../apps/api/src/application/use-cases/seo-growth/SeoGuardianPolicy';

const at = (iso: string) => new Date(iso);
const switches = (over: Partial<KillSwitches> = {}): KillSwitches => ({
  ...DEFAULT_KILL_SWITCHES,
  autonomousWritesEnabled: true,
  observeOnlyMode: false,
  ...over,
});

// ── Freshness ───────────────────────────────────────────────────────────────

describe('source freshness cannot manufacture an incident', () => {
  it('reports UNKNOWN — never zero — when no data is stored', () => {
    const f = assessFreshness({ latestSourceDate: null, observedAt: at('2026-08-13T00:00:00Z') });
    expect(f.state).toBe('UNKNOWN');
    expect(f.comparisonValid).toBe(false);
    expect(f.reason).not.toMatch(/\b0 clicks|zero\b/i);
  });

  it('refuses to compare while the current window is still settling', () => {
    // 2 days behind: normal GSC latency, NOT a traffic drop.
    const f = assessFreshness({ latestSourceDate: '2026-08-11', observedAt: at('2026-08-13T00:00:00Z') });
    expect(f.state).toBe('PARTIAL');
    expect(f.comparisonValid).toBe(false);
  });

  it('escalates to DELAYED past the settle window and STALE past the feed limit', () => {
    expect(assessFreshness({ latestSourceDate: '2026-08-09', observedAt: at('2026-08-13T00:00:00Z') }).state).toBe('DELAYED');
    expect(assessFreshness({ latestSourceDate: '2026-08-06', observedAt: at('2026-08-13T00:00:00Z') }).state).toBe('STALE');
  });

  it('only allows comparison when the data is settled', () => {
    const f = assessFreshness({ latestSourceDate: '2026-08-13', observedAt: at('2026-08-13T00:00:00Z') });
    expect(f.state).toBe('COMPLETE');
    expect(f.comparisonValid).toBe(true);
  });
});

// ── Materiality ─────────────────────────────────────────────────────────────

describe('materiality refuses to alert on noise', () => {
  it('treats a 50% loss on a tiny baseline as insufficient, not material', () => {
    const m = assessMateriality({ baselineClicks: 2, currentClicks: 1, comparisonValid: true });
    expect(m.verdict).toBe('INSUFFICIENT_BASELINE');
  });

  it('treats a 20% loss on a large qualified baseline as material', () => {
    const m = assessMateriality({ baselineClicks: 5000, currentClicks: 4000, comparisonValid: true });
    expect(m.verdict).toBe('MATERIAL');
    expect(m.direction).toBe('DOWN');
    expect(m.absoluteChange).toBe(-1000);
  });

  it('requires BOTH a relative and an absolute move', () => {
    // 40% relative but only 8 clicks — below the absolute floor.
    expect(assessMateriality({ baselineClicks: 30, currentClicks: 22, comparisonValid: true }).verdict).toBe('IMMATERIAL');
    // Large absolute but tiny relative.
    expect(assessMateriality({ baselineClicks: 100_000, currentClicks: 99_000, comparisonValid: true }).verdict).toBe('IMMATERIAL');
  });

  it('never calls anything material when the periods are not comparable', () => {
    const m = assessMateriality({ baselineClicks: 5000, currentClicks: 0, comparisonValid: false });
    expect(m.verdict).toBe('NOT_COMPARABLE');
  });

  it('lowers but never removes the bar for commercially important entities', () => {
    const base = { baselineClicks: 60, currentClicks: 54, comparisonValid: true }; // -10%, -6
    expect(assessMateriality(base).verdict).toBe('IMMATERIAL');
    expect(assessMateriality({ ...base, commerciallyImportant: true }).verdict).toBe('MATERIAL');
    // Still bounded by the baseline floor even when important.
    expect(assessMateriality({ baselineClicks: 3, currentClicks: 0, comparisonValid: true, commerciallyImportant: true }).verdict)
      .toBe('INSUFFICIENT_BASELINE');
  });
});

// ── Hysteresis ──────────────────────────────────────────────────────────────

describe('hysteresis stops the agent flapping every six hours', () => {
  it('does not act on a single observation', () => {
    const r = advanceHysteresis({ previousState: null, presentNow: true, consecutiveObservations: 0 });
    expect(r.state).toBe('FIRST_OBSERVED');
    expect(r.actionable).toBe(false);
  });

  it('confirms only after the condition persists', () => {
    const r = advanceHysteresis({ previousState: 'FIRST_OBSERVED', presentNow: true, consecutiveObservations: 1 });
    expect(r.state).toBe('CONFIRMED');
    expect(r.actionable).toBe(true);
    expect(r.notableTransition).toBe(true);
  });

  it('does not re-notify on every subsequent run of the same problem', () => {
    const r = advanceHysteresis({ previousState: 'CONFIRMED', presentNow: true, consecutiveObservations: 5 });
    expect(r.state).toBe('ONGOING');
    expect(r.notableTransition).toBe(false);
  });

  it('lets a critical technical state bypass persistence', () => {
    // Waiting another six hours to confirm a site-wide deindexing IS the harm.
    const r = advanceHysteresis({ previousState: null, presentNow: true, consecutiveObservations: 0, criticalTechnical: true });
    expect(r.state).toBe('CONFIRMED');
    expect(r.actionable).toBe(true);
  });

  it('requires two clean runs before declaring recovery', () => {
    const first = advanceHysteresis({ previousState: 'ONGOING', presentNow: false, consecutiveObservations: 0 });
    expect(first.state).toBe('RECOVERING');
    expect(first.notableTransition).toBe(false);
    const second = advanceHysteresis({ previousState: 'RECOVERING', presentNow: false, consecutiveObservations: 0 });
    expect(second.state).toBe('RECOVERED');
    expect(second.notableTransition).toBe(true);
  });

  it('treats a relapse as newly notable', () => {
    const r = advanceHysteresis({ previousState: 'RECOVERED', presentNow: true, consecutiveObservations: 0 });
    expect(r.state).toBe('CONFIRMED');
    expect(r.notableTransition).toBe(true);
  });
});

// ── Autonomy ────────────────────────────────────────────────────────────────

const autonomyBase = {
  earnedLevel: 4 as const,
  killSwitches: switches(),
  circuitState: 'CLOSED' as const,
  budget: { withinBudget: true, reason: 'ok' },
  canaryComplete: true,
  signalActionable: true,
};

describe('autonomy is earned per class, never global', () => {
  it('never performs a destructive action autonomously, even at the top level', () => {
    const d = decideAutonomy({ ...autonomyBase, tier: 'TIER_4_DESTRUCTIVE' });
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.code).toBe('TIER_NEVER_AUTONOMOUS');
  });

  it('blocks a reversible action from a class that has not earned the level', () => {
    const d = decideAutonomy({ ...autonomyBase, tier: 'TIER_2_REVERSIBLE', earnedLevel: 1 });
    expect(d.allowed === false && d.code).toBe('INSUFFICIENT_AUTONOMY');
  });

  it('refuses to act on an unconfirmed signal', () => {
    const d = decideAutonomy({ ...autonomyBase, tier: 'TIER_1_INTERNAL', signalActionable: false });
    expect(d.allowed === false && d.code).toBe('SIGNAL_NOT_CONFIRMED');
  });

  it('honours observe-only mode and the kill switches', () => {
    expect(decideAutonomy({ ...autonomyBase, tier: 'TIER_1_INTERNAL', killSwitches: switches({ observeOnlyMode: true }) }))
      .toMatchObject({ allowed: false, code: 'OBSERVE_ONLY' });
    expect(decideAutonomy({ ...autonomyBase, tier: 'TIER_1_INTERNAL', killSwitches: switches({ organicAgentsEnabled: false }) }))
      .toMatchObject({ allowed: false, code: 'AGENTS_DISABLED' });
    expect(decideAutonomy({ ...autonomyBase, tier: 'TIER_2_REVERSIBLE', killSwitches: switches({ autonomousWritesEnabled: false }) }))
      .toMatchObject({ allowed: false, code: 'WRITES_DISABLED' });
  });

  it('stops writing when the circuit is open but still permits observation elsewhere', () => {
    const d = decideAutonomy({ ...autonomyBase, tier: 'TIER_1_INTERNAL', circuitState: 'OPEN' });
    expect(d.allowed === false && d.code).toBe('CIRCUIT_OPEN');
  });

  it('forces a canary for a class that has never run, and while half-open', () => {
    expect(decideAutonomy({ ...autonomyBase, tier: 'TIER_2_REVERSIBLE', canaryComplete: false }))
      .toEqual({ allowed: true, mode: 'CANARY' });
    expect(decideAutonomy({ ...autonomyBase, tier: 'TIER_2_REVERSIBLE', circuitState: 'HALF_OPEN' }))
      .toEqual({ allowed: true, mode: 'CANARY' });
  });

  it('allows a proven class to run fully', () => {
    expect(decideAutonomy({ ...autonomyBase, tier: 'TIER_2_REVERSIBLE' })).toEqual({ allowed: true, mode: 'FULL' });
  });

  it('defaults to safe: out of the box nothing may mutate', () => {
    expect(DEFAULT_KILL_SWITCHES.observeOnlyMode).toBe(true);
    expect(DEFAULT_KILL_SWITCHES.autonomousWritesEnabled).toBe(false);
    expect(DEFAULT_KILL_SWITCHES.contentAutopublishEnabled).toBe(false);
  });
});

// ── Blast radius ────────────────────────────────────────────────────────────

describe('a misfiring classifier cannot move the site', () => {
  it('caps URLs per remediation class', () => {
    const v = checkBudget({ proposedUrls: DEFAULT_CHANGE_BUDGET.maxUrlsPerRemediationClass + 1, indexableInventory: 100_000 });
    expect(v.withinBudget).toBe(false);
  });

  it('caps the share of indexable inventory even for a small absolute count', () => {
    // 10 URLs out of 100 is 10% — over the 5% ceiling.
    const v = checkBudget({ proposedUrls: 10, indexableInventory: 100 });
    expect(v.withinBudget).toBe(false);
    expect(v.reason).toMatch(/inventory/i);
  });

  it('permits a proportionate change', () => {
    expect(checkBudget({ proposedUrls: 10, indexableInventory: 100_000 }).withinBudget).toBe(true);
  });
});

// ── Circuit breaker ─────────────────────────────────────────────────────────

const circuitBase = {
  providerResponseAbnormal: false,
  freshness: 'COMPLETE' as const,
  authChangedUnexpectedly: false,
  proposedWritesExceedBudget: false,
  consecutiveVerificationFailures: 0,
  falsePositiveRate: 0.05,
  implausibleMassChange: false,
};

describe('the circuit opens on every documented condition', () => {
  it('stays closed on a healthy run', () => {
    expect(evaluateCircuit(circuitBase).state).toBe('CLOSED');
  });

  it.each([
    ['providerResponseAbnormal', { providerResponseAbnormal: true }],
    ['stale source', { freshness: 'STALE' as const }],
    ['unknown source', { freshness: 'UNKNOWN' as const }],
    ['auth changed', { authChangedUnexpectedly: true }],
    ['over budget', { proposedWritesExceedBudget: true }],
    ['implausible mass change', { implausibleMassChange: true }],
    ['verification failures', { consecutiveVerificationFailures: 3 }],
    ['false positives', { falsePositiveRate: 0.5 }],
  ])('opens on %s', (_label, over) => {
    const d = evaluateCircuit({ ...circuitBase, ...over });
    expect(d.state).toBe('OPEN');
    expect(d.reasons.length).toBeGreaterThan(0);
  });
});

// ── Idempotency ─────────────────────────────────────────────────────────────

describe('the same unresolved condition does not repeat every six hours', () => {
  const parts = {
    provider: 'GSC', property: 'sc-domain:shopgoldplus.com', entity: '/power',
    changeType: 'CLICK_DROP', sourceStateVersion: '2026-08-12', action: 'OPEN_INCIDENT',
    policyVersion: GUARDIAN_POLICY_VERSION,
  };

  it('is stable across runs for an unchanged condition', () => {
    expect(idempotencyKey(parts)).toBe(idempotencyKey({ ...parts }));
  });

  it('excludes the run time, so a re-run does not mint a new key', () => {
    expect(idempotencyKey(parts)).not.toMatch(/\d{2}:\d{2}/);
  });

  it('changes when the underlying source state advances', () => {
    expect(idempotencyKey({ ...parts, sourceStateVersion: '2026-08-13' })).not.toBe(idempotencyKey(parts));
  });

  it('changes when the policy version changes', () => {
    expect(idempotencyKey({ ...parts, policyVersion: '2.0.0' })).not.toBe(idempotencyKey(parts));
  });

  it('separates entities and action types', () => {
    expect(idempotencyKey({ ...parts, entity: '/audio' })).not.toBe(idempotencyKey(parts));
    expect(idempotencyKey({ ...parts, action: 'RESUBMIT_SITEMAP' })).not.toBe(idempotencyKey(parts));
  });
});

// ── Notification ────────────────────────────────────────────────────────────

describe('a clean run is silent', () => {
  it('sends nothing when nothing material happened', () => {
    const d = decideNotification({ events: [], killSwitches: switches() });
    expect(d.send).toBe(false);
  });

  it('sends exactly one aggregated message for many events', () => {
    const d = decideNotification({
      events: ['INCIDENT_OPENED', 'MATERIAL_CHANGE', 'INCIDENT_OPENED'],
      killSwitches: switches(),
    });
    expect(d.send).toBe(true);
    expect(d.events).toHaveLength(2); // deduplicated
  });

  it('respects the email kill switch', () => {
    expect(decideNotification({ events: ['INCIDENT_OPENED'], killSwitches: switches({ emailNotificationsEnabled: false }) }).send)
      .toBe(false);
  });
});

// ── End-to-end policy chain ─────────────────────────────────────────────────

describe('the chain as a whole refuses to act on latency', () => {
  it('a partial-data "collapse" produces no incident, no action, no email', () => {
    // GSC is 2 days behind — the classic false alarm.
    const freshness = assessFreshness({ latestSourceDate: '2026-08-11', observedAt: at('2026-08-13T00:00:00Z') });
    const materiality = assessMateriality({
      baselineClicks: 5000, currentClicks: 400, comparisonValid: freshness.comparisonValid,
    });
    expect(materiality.verdict).toBe('NOT_COMPARABLE');

    const signal = advanceHysteresis({
      previousState: null,
      presentNow: materiality.verdict === 'MATERIAL',
      consecutiveObservations: 0,
    });
    expect(signal.actionable).toBe(false);

    const decision = decideAutonomy({
      ...autonomyBase, tier: 'TIER_2_REVERSIBLE', signalActionable: signal.actionable,
    });
    expect(decision.allowed).toBe(false);

    const notify = decideNotification({ events: [], killSwitches: switches() });
    expect(notify.send).toBe(false);
  });

  it('a real, persisted, comparable drop does become actionable', () => {
    const freshness = assessFreshness({ latestSourceDate: '2026-08-13', observedAt: at('2026-08-13T00:00:00Z') });
    const materiality = assessMateriality({
      baselineClicks: 5000, currentClicks: 3500, comparisonValid: freshness.comparisonValid,
    });
    expect(materiality.verdict).toBe('MATERIAL');

    let state: SignalState | null = null;
    let runs = 0;
    for (let i = 0; i < 2; i += 1) {
      const r = advanceHysteresis({ previousState: state, presentNow: true, consecutiveObservations: runs });
      state = r.state;
      runs += 1;
    }
    expect(state).toBe('CONFIRMED');
    expect(decideNotification({ events: ['INCIDENT_OPENED'], killSwitches: switches() }).send).toBe(true);
  });
});
