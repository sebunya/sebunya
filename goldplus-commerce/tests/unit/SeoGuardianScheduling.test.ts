import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  evaluateProviderGate,
  resolveBaselinePhase,
  backfillWindows,
  BACKFILL_CONSTRAINTS,
  assessLevel1Readiness,
  RUNS_BEFORE_LEVEL_1,
} from '../../apps/api/src/application/use-cases/seo-growth/SeoGuardianReadiness';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const workers = read('apps/api/src/infrastructure/queues/QueueWorkers.ts');
const runner = read('apps/api/src/infrastructure/seo/SearchConsoleGuardianRunner.ts');

describe('exactly one six-hourly Guardian schedule exists', () => {
  it('registers the cron once, on the six-hour pattern', () => {
    const registrations = workers.match(/'search-console-guardian-cron'/g) ?? [];
    expect(registrations).toHaveLength(2); // one dispatch branch + one registration
    expect(workers).toContain("pattern: '0 */6 * * *'");
    expect(workers.match(/pattern: '0 \*\/6 \* \* \*'/g)).toHaveLength(1);
  });

  it('pins a stable jobId so replicas cannot create parallel schedules', () => {
    expect(workers).toContain("jobId: 'search-console-guardian-job'");
  });

  it('reuses the existing queue rather than adding a scheduler', () => {
    expect(workers).toContain('syntheticQueue.add');
    expect(runner).not.toMatch(/new Queue\(|new Worker\(|node-cron|setInterval/);
  });

  it('is not hourly — Search Console settles over days, not hours', () => {
    expect(workers).not.toMatch(/'search-console-guardian-cron'[\s\S]{0,200}pattern: '0 \* \* \* \*'/);
  });
});

describe('the runner protects itself and the shared queue', () => {
  it('takes a distributed advisory lock and releases it', () => {
    expect(runner).toContain('pg_try_advisory_lock');
    expect(runner).toContain('pg_advisory_unlock');
    expect(runner).toContain('finally');
  });

  it('recovers a crashed predecessor instead of blocking for ever', () => {
    expect(runner).toContain('STALE_RUN_MINUTES');
    expect(runner).toMatch(/status = 'FAILED'[\s\S]{0,200}Abandoned/);
  });

  it('contains its own failures so commerce fan-out is unaffected', () => {
    expect(runner).toMatch(/Provider failure isolation/i);
    expect(runner).toContain('contained');
  });

  it('matches the PARTIAL unique index when upserting an alert', () => {
    // seo_alerts' index is UNIQUE (dedupe_key) WHERE status = 'OPEN'.
    // Omitting the predicate would fail at runtime, not at compile time.
    expect(runner).toContain("on conflict (dedupe_key) where status = 'OPEN'");
  });

  it('reuses seo_alerts and does not invent a second incident store', () => {
    expect(runner).toContain('insert into seo_alerts');
    expect(runner).not.toMatch(/create table|seo_incidents/i);
  });

  it('does not fabricate a false-positive rate before outcomes are labelled', () => {
    expect(runner).toMatch(/recentFalsePositiveRate[\s\S]{0,300}return null/);
  });

  it('routes notification to the run record and audit, not to a pretend email', () => {
    expect(runner).toContain('CONTROL_CENTER_AND_AUDIT_ONLY');
    expect(runner).toContain('delivered: false');
    expect(runner).not.toMatch(/zeptomail|sendMail|smtp/i);
  });
});

describe('the provider gate keeps a credential-less schedule silent', () => {
  it('is silent when nothing is connected yet', () => {
    const g = evaluateProviderGate({ connectionStatus: null, hasActiveCredential: false, propertyConfigured: false });
    expect(g).toMatchObject({ readiness: 'WAITING_FOR_CREDENTIAL', proceed: false, silent: true });
  });

  it('is silent for a half-configured connection', () => {
    expect(evaluateProviderGate({ connectionStatus: 'CONFIGURING', hasActiveCredential: true, propertyConfigured: false }).silent).toBe(true);
    expect(evaluateProviderGate({ connectionStatus: 'CONFIGURING', hasActiveCredential: false, propertyConfigured: false }).silent).toBe(true);
  });

  it('is NOT silent when a previously working credential breaks', () => {
    const g = evaluateProviderGate({ connectionStatus: 'AUTH_EXPIRED', hasActiveCredential: true, propertyConfigured: true });
    expect(g).toMatchObject({ readiness: 'AUTHORIZATION_REQUIRED', proceed: false, silent: false });
  });

  it('is NOT silent when the provider is erroring', () => {
    expect(evaluateProviderGate({ connectionStatus: 'ERROR', hasActiveCredential: true, propertyConfigured: true }))
      .toMatchObject({ readiness: 'DEGRADED', silent: false });
  });

  it('proceeds only when connected with a credential and a property', () => {
    expect(evaluateProviderGate({ connectionStatus: 'CONNECTED', hasActiveCredential: true, propertyConfigured: true }).proceed).toBe(true);
    expect(evaluateProviderGate({ connectionStatus: 'DISABLED', hasActiveCredential: true, propertyConfigured: true }).proceed).toBe(false);
  });
});

describe('baseline phases replace waiting a week', () => {
  it('demands historical context before classifying', () => {
    const p = resolveBaselinePhase({ providerConnected: true, historicalBackfillComplete: false, validLiveRuns: 9 });
    expect(p).toMatchObject({ phase: 'BACKFILL_PENDING', mayClassify: false, shouldBackfill: true });
  });

  it('captures then confirms then activates', () => {
    const base = { providerConnected: true, historicalBackfillComplete: true };
    expect(resolveBaselinePhase({ ...base, validLiveRuns: 0 }).phase).toBe('BASELINE_CAPTURE');
    expect(resolveBaselinePhase({ ...base, validLiveRuns: 1 }).phase).toBe('BASELINE_CONFIRMATION');
    expect(resolveBaselinePhase({ ...base, validLiveRuns: 2 })).toMatchObject({
      phase: 'OBSERVE_ONLY_ACTIVE', mayClassify: true,
    });
  });

  it('never classifies without a provider', () => {
    expect(resolveBaselinePhase({ providerConnected: false, historicalBackfillComplete: true, validLiveRuns: 99 }).mayClassify).toBe(false);
  });
});

describe('backfill is archaeology, not monitoring', () => {
  it('forbids notification, external mutation, incidents and baseline overwrite', () => {
    expect(BACKFILL_CONSTRAINTS).toEqual({
      mayNotify: false, mayMutateExternally: false, mayOpenIncidents: false, mayOverwriteLiveBaseline: false,
    });
  });

  it('builds four comparable complete windows ending at the settled date', () => {
    const w = backfillWindows('2026-08-10');
    expect(w.map((x) => x.label)).toEqual(['LAST_7', 'PREVIOUS_7', 'LAST_28', 'PREVIOUS_28']);
    expect(w[0]).toMatchObject({ startDate: '2026-08-04', endDate: '2026-08-10' });
    // The previous window must not overlap the current one.
    expect(w[1].endDate < w[0].startDate).toBe(true);
    expect(w[3].endDate < w[2].startDate).toBe(true);
  });

  it('returns nothing when the provider has no settled data', () => {
    expect(backfillWindows(null)).toEqual([]);
    expect(backfillWindows('not-a-date')).toEqual([]);
  });
});

describe('level 1 must be earned on evidence, not on a calendar', () => {
  const green = {
    sourceFreshnessStable: true, baselineStable: true, policyStable: true, idempotencyProven: true,
    circuitGreen: true, changeBudgetGreen: true, incidentDedupGreen: true, validLiveRuns: RUNS_BEFORE_LEVEL_1,
  };

  it('is ready when every condition holds', () => {
    expect(assessLevel1Readiness(green)).toEqual({ ready: true, missing: [] });
  });

  it('names precisely what is missing', () => {
    const r = assessLevel1Readiness({ ...green, circuitGreen: false, validLiveRuns: 1 });
    expect(r.ready).toBe(false);
    expect(r.missing).toContain('CIRCUIT_BREAKER_GREEN');
    expect(r.missing).toContain(`VALID_LIVE_RUNS>=${RUNS_BEFORE_LEVEL_1}`);
  });
});
