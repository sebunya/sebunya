import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  SearchConsoleGuardianUseCase,
  GUARDIAN_AGENT,
  type GuardianPorts,
  type GuardianEntityWindow,
  type GuardianStoredSignal,
} from '../../apps/api/src/application/use-cases/seo-growth/SearchConsoleGuardianUseCase';
import { DEFAULT_KILL_SWITCHES } from '../../apps/api/src/application/use-cases/seo-growth/SeoGuardianPolicy';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

interface Recorded {
  incidents: Array<{ dedupeKey: string; severity: string }>;
  resolved: string[];
  actions: Array<{ decision: string; reason: string; mode: string | null }>;
  notifications: Array<{ events: string[]; summary: string }>;
  saved: Array<{ key: string; state: string; consecutive: number }>;
  finished: Array<Record<string, unknown>>;
}

function harness(over: {
  latestSourceDate?: string | null;
  windows?: GuardianEntityWindow[];
  signal?: GuardianStoredSignal | null;
  policy?: Partial<{
    killSwitches: typeof DEFAULT_KILL_SWITCHES;
    autonomyByClass: Record<string, { earnedLevel: 0 | 1 | 2 | 3 | 4; canaryComplete: boolean }>;
  }>;
  health?: { abnormal: boolean; authChanged: boolean };
  leaseHeld?: boolean;
  throwOn?: 'entityWindows';
} = {}) {
  const rec: Recorded = { incidents: [], resolved: [], actions: [], notifications: [], saved: [], finished: [] };
  const existingIncidents = new Set<string>();

  const ports: GuardianPorts = {
    latestSourceDate: async () => (over.latestSourceDate === undefined ? '2026-08-13' : over.latestSourceDate),
    entityWindows: async () => {
      if (over.throwOn === 'entityWindows') throw new Error('provider exploded');
      return over.windows ?? [];
    },
    loadPolicy: async () => ({
      killSwitches: over.policy?.killSwitches ?? { ...DEFAULT_KILL_SWITCHES },
      autonomyByClass: over.policy?.autonomyByClass ?? {},
    }),
    loadSignal: async () => over.signal ?? null,
    saveSignal: async (i) => {
      rec.saved.push({ key: i.key, state: i.state, consecutive: i.consecutiveObservations });
      return { id: `sig-${rec.saved.length}` };
    },
    openOrUpdateIncident: async (i) => {
      const created = !existingIncidents.has(i.dedupeKey);
      existingIncidents.add(i.dedupeKey);
      rec.incidents.push({ dedupeKey: i.dedupeKey, severity: i.severity });
      return { id: `inc-${rec.incidents.length}`, created };
    },
    resolveIncident: async (k) => { rec.resolved.push(k); },
    recordAction: async (a) => { rec.actions.push({ decision: a.decision, reason: a.decisionReason, mode: a.mode }); },
    startRun: async () => (over.leaseHeld ? null : { runId: 'run-1' }),
    finishRun: async (f) => { rec.finished.push(f as unknown as Record<string, unknown>); },
    providerHealth: async () => over.health ?? { abnormal: false, authChanged: false },
    indexableInventory: async () => 10_000,
    recentFalsePositiveRate: async () => 0.02,
    sendAggregatedNotification: async (n) => {
      rec.notifications.push({ events: [...n.events], summary: n.summary });
      return { delivered: true };
    },
  };

  const uc = new SearchConsoleGuardianUseCase(ports, 'sc-domain:shopgoldplus.com', () => new Date('2026-08-13T06:00:00Z'));
  return { uc, rec };
}

const bigDrop: GuardianEntityWindow[] = [{ entity: '/power', baselineClicks: 5000, currentClicks: 3500 }];

describe('the Guardian stands down rather than double-running', () => {
  it('does nothing when another worker holds the lease', async () => {
    const { uc, rec } = harness({ leaseHeld: true });
    const r = await uc.execute();
    expect(r.ran).toBe(false);
    expect(rec.finished).toHaveLength(0);
    expect(rec.notifications).toHaveLength(0);
  });
});

describe('a clean run is silent and still recorded', () => {
  it('records a heartbeat but sends nothing when nothing changed', async () => {
    const { uc, rec } = harness({ windows: [{ entity: '/power', baselineClicks: 5000, currentClicks: 4990 }] });
    const r = await uc.execute();
    expect(r.materialChanges).toBe(0);
    expect(r.notificationSent).toBe(false);
    expect(rec.incidents).toHaveLength(0);
    // The run is still persisted — "no change" is a result.
    expect(rec.finished).toHaveLength(1);
    expect(rec.finished[0].status).toBe('COMPLETED');
    expect(r.summary).toMatch(/no material change/i);
  });
});

describe('provider latency never becomes an incident', () => {
  it('draws no comparison while the source window is still settling', async () => {
    // Two days behind: a 92% "collapse" that is really back-fill latency.
    const { uc, rec } = harness({
      latestSourceDate: '2026-08-11',
      windows: [{ entity: '/power', baselineClicks: 5000, currentClicks: 400 }],
    });
    const r = await uc.execute();
    expect(r.freshness?.state).toBe('PARTIAL');
    expect(r.materialChanges).toBe(0);
    expect(rec.incidents).toHaveLength(0);
    expect(r.notificationSent).toBe(false);
    expect(r.summary).toMatch(/no comparison drawn/i);
  });

  it('flags a stale feed as a source problem, not a traffic problem', async () => {
    const { uc, rec } = harness({ latestSourceDate: '2026-08-01', windows: bigDrop });
    const r = await uc.execute();
    expect(r.freshness?.state).toBe('STALE');
    expect(r.events).toContain('SOURCE_STALE');
    expect(rec.incidents).toHaveLength(0);
    // A stale source also opens the circuit — writes stop, observation continues.
    expect(r.circuitState).toBe('OPEN');
  });

  it('treats no stored data as UNKNOWN rather than zero clicks', async () => {
    const { uc } = harness({ latestSourceDate: null, windows: bigDrop });
    const r = await uc.execute();
    expect(r.freshness?.state).toBe('UNKNOWN');
    expect(r.materialChanges).toBe(0);
  });
});

describe('hysteresis governs when an incident may open', () => {
  it('opens nothing on the first observation of a real drop', async () => {
    const { uc, rec } = harness({ windows: bigDrop });
    const r = await uc.execute();
    expect(r.materialChanges).toBe(1);      // the change is real and recorded
    expect(rec.incidents).toHaveLength(0);  // but not yet confirmed
    expect(rec.saved[0].state).toBe('FIRST_OBSERVED');
    expect(rec.saved[0].consecutive).toBe(1);
  });

  it('opens exactly one incident when the drop persists', async () => {
    const { uc, rec } = harness({
      windows: bigDrop,
      signal: { id: 's1', state: 'FIRST_OBSERVED', consecutiveObservations: 1, alertId: null },
    });
    const r = await uc.execute();
    expect(rec.incidents).toHaveLength(1);
    expect(r.events).toContain('INCIDENT_OPENED');
    expect(r.notificationSent).toBe(true);
  });

  it('does not re-open or re-notify an already-ongoing incident', async () => {
    const { uc, rec } = harness({
      windows: bigDrop,
      signal: { id: 's1', state: 'CONFIRMED', consecutiveObservations: 4, alertId: 'a1' },
    });
    const r = await uc.execute();
    expect(rec.saved[0].state).toBe('ONGOING');
    expect(rec.incidents).toHaveLength(0);
    expect(r.events).not.toContain('INCIDENT_OPENED');
  });

  it('resolves and reports recovery only after it holds', async () => {
    const recovering = harness({
      windows: [{ entity: '/power', baselineClicks: 5000, currentClicks: 5000 }],
      signal: { id: 's1', state: 'ONGOING', consecutiveObservations: 3, alertId: 'a1' },
    });
    const first = await recovering.uc.execute();
    expect(recovering.rec.saved[0].state).toBe('RECOVERING');
    expect(recovering.rec.resolved).toHaveLength(0);
    expect(first.events).not.toContain('RECOVERY_VERIFIED');

    const recovered = harness({
      windows: [{ entity: '/power', baselineClicks: 5000, currentClicks: 5000 }],
      signal: { id: 's1', state: 'RECOVERING', consecutiveObservations: 0, alertId: 'a1' },
    });
    const second = await recovered.uc.execute();
    expect(recovered.rec.resolved).toHaveLength(1);
    expect(second.events).toContain('RECOVERY_VERIFIED');
  });
});

describe('the default posture is observe-only', () => {
  it('denies every action out of the box and says why', async () => {
    const { uc, rec } = harness({
      windows: bigDrop,
      signal: { id: 's1', state: 'FIRST_OBSERVED', consecutiveObservations: 1, alertId: null },
    });
    const r = await uc.execute();
    expect(r.actionsAttempted).toBe(0);
    expect(rec.actions[0].decision).toBe('DENIED');
    expect(rec.actions[0].reason).toMatch(/observe-only/i);
  });

  it('still refuses once observe-only is lifted but the class has not earned autonomy', async () => {
    const { uc, rec } = harness({
      windows: bigDrop,
      signal: { id: 's1', state: 'FIRST_OBSERVED', consecutiveObservations: 1, alertId: null },
      policy: {
        killSwitches: { ...DEFAULT_KILL_SWITCHES, observeOnlyMode: false, autonomousWritesEnabled: true },
        autonomyByClass: {},
      },
    });
    await uc.execute();
    expect(rec.actions[0].decision).toBe('DENIED');
    expect(rec.actions[0].reason).toMatch(/level/i);
  });

  it('permits a canary once the class has earned it', async () => {
    const { uc, rec } = harness({
      windows: bigDrop,
      signal: { id: 's1', state: 'FIRST_OBSERVED', consecutiveObservations: 1, alertId: null },
      policy: {
        killSwitches: { ...DEFAULT_KILL_SWITCHES, observeOnlyMode: false, autonomousWritesEnabled: true },
        autonomyByClass: { GSC_CLICK_DROP_INVESTIGATION: { earnedLevel: 1, canaryComplete: false } },
      },
    });
    const r = await uc.execute();
    expect(rec.actions[0].decision).toBe('ALLOWED');
    expect(rec.actions[0].mode).toBe('CANARY');
    expect(r.actionsAttempted).toBe(1);
  });
});

describe('provider trouble stops writes but never stops observing', () => {
  it('opens the circuit on abnormal provider health and denies action', async () => {
    const { uc, rec } = harness({
      windows: bigDrop,
      health: { abnormal: true, authChanged: true },
      signal: { id: 's1', state: 'FIRST_OBSERVED', consecutiveObservations: 1, alertId: null },
      policy: {
        killSwitches: { ...DEFAULT_KILL_SWITCHES, observeOnlyMode: false, autonomousWritesEnabled: true },
        autonomyByClass: { GSC_CLICK_DROP_INVESTIGATION: { earnedLevel: 4, canaryComplete: true } },
      },
    });
    const r = await uc.execute();
    expect(r.circuitState).toBe('OPEN');
    expect(r.events).toEqual(expect.arrayContaining(['AUTH_CHANGED', 'PROVIDER_DEGRADED', 'CIRCUIT_OPENED']));
    expect(rec.actions[0].decision).toBe('DENIED');
    // Observation still happened.
    expect(rec.saved).toHaveLength(1);
  });
});

describe('a thrown run fails safe', () => {
  it('records the failure and reports AGENT_FAILED without acting', async () => {
    const { uc, rec } = harness({ throwOn: 'entityWindows' });
    const r = await uc.execute();
    expect(r.events).toContain('AGENT_FAILED');
    expect(r.circuitState).toBe('OPEN');
    expect(rec.finished[0].status).toBe('FAILED');
    expect(rec.incidents).toHaveLength(0);
  });
});

describe('one run produces at most one aggregated message', () => {
  it('aggregates many entities into a single notification', async () => {
    const { uc, rec } = harness({
      windows: [
        { entity: '/power', baselineClicks: 5000, currentClicks: 3500 },
        { entity: '/audio', baselineClicks: 4000, currentClicks: 2800 },
      ],
      signal: { id: 's1', state: 'FIRST_OBSERVED', consecutiveObservations: 1, alertId: null },
    });
    await uc.execute();
    expect(rec.notifications).toHaveLength(1);
    expect(rec.notifications[0].events).toContain('INCIDENT_OPENED');
  });
});

describe('the guardian is wired to the existing infrastructure, not a parallel one', () => {
  const migration = read('apps/api/src/infrastructure/db/migrations/0121_seo_guardian.sql');

  it('reuses the existing seo_alerts table for incidents', () => {
    expect(migration).toContain('REFERENCES seo_alerts(id)');
    expect(migration).not.toMatch(/CREATE TABLE seo_incidents/i);
  });

  it('keys signals and actions by idempotency so six-hourly runs cannot duplicate', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX seo_guardian_signals_key_idx');
    expect(migration).toContain('CREATE UNIQUE INDEX seo_guardian_actions_key_idx');
  });

  it('defaults the stored policy to observe-only with writes off', () => {
    expect(migration).toMatch(/observe_only_mode boolean NOT NULL DEFAULT true/);
    expect(migration).toMatch(/autonomous_writes_enabled boolean NOT NULL DEFAULT false/);
    expect(migration).toMatch(/external_writes_enabled boolean NOT NULL DEFAULT false/);
    expect(migration).toMatch(/content_autopublish_enabled boolean NOT NULL DEFAULT false/);
  });

  it('registers migration 0121 with a monotonic timestamp', () => {
    const journal = JSON.parse(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json'));
    const entry = journal.entries.find((e: any) => e.tag === '0121_seo_guardian');
    expect(entry).toBeTruthy();
    const prior = journal.entries.find((e: any) => e.idx === entry.idx - 1);
    expect(entry.when).toBeGreaterThan(prior.when);
  });

  it('names the agent consistently', () => {
    expect(GUARDIAN_AGENT).toBe('SEARCH_CONSOLE_GUARDIAN');
  });
});
