import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GetPerformanceAuditOverviewUseCase,
  GetPerformanceAuditRunUseCase,
  RequestPerformanceAuditRunUseCase,
  MAX_ADMIN_RUNS_PER_DAY,
  deriveHealth,
  validateRunRequestInput,
} from '../../apps/api/src/application/use-cases/seo-growth/PerformanceAuditUseCases';
import { FilesystemPerformanceAuditStore } from '../../apps/api/src/infrastructure/performance-audit/FilesystemPerformanceAuditStore';

/**
 * Continuous Performance Assurance — admin surface (2026-09-13).
 * The API only reads the host audit's files and queues requests. These tests
 * drive the real filesystem store against a temp directory shaped like the
 * host data dir, so the contract with performance-audit/run_all.sh is exercised.
 */
const NOW = new Date('2026-09-14T09:00:00Z');

function dataDir(withRun = true): string {
  const d = mkdtempSync(join(tmpdir(), 'perf-audit-admin-'));
  for (const sub of ['reports', 'state', 'requests/queue', 'requests/processing', 'requests/done']) mkdirSync(join(d, sub), { recursive: true });
  writeFileSync(join(d, 'state/schedule.json'), JSON.stringify({
    last_attempt_at: '2026-09-13T06:50:47Z', last_success_at: '2026-09-13T06:52:00Z', last_success_run_id: '20260913T065047Z',
    next_due_at: '2026-09-23T06:52:00Z', retry_count: 0, cycle_failed: false,
    history: [{ run_id: '20260913T065047Z', kind: 'recurring', label: 'pre-cloudflare-baseline', outcome: 'SUCCESS', started_at: '2026-09-13T06:52:00Z' }],
  }));
  writeFileSync(join(d, 'state/last_tick_at'), '2026-09-14T02:43:00Z\n');
  if (withRun) {
    const r = join(d, 'reports/20260913T065047Z'); mkdirSync(join(r, 'providers/control'), { recursive: true });
    writeFileSync(join(r, 'manifest.json'), JSON.stringify({ run_id: '20260913T065047Z', kind: 'recurring', label: 'pre-cloudflare-baseline', outcome: 'SUCCESS', started_at: '2026-09-13T06:50:47Z', finished_at: '2026-09-13T06:52:00Z', repo_sha: '80c13535', target: 'https://shopgoldplus.com', metric_count: 75, providers: { control: 'IMPLEMENTED_AND_VERIFIED', gtmetrix: 'IMPLEMENTED_AWAITING_CREDENTIALS' }, regression_counts: { PASS: 63, NO_DATA: 11 }, previous_run: null }));
    writeFileSync(join(r, 'regression.json'), JSON.stringify({ rows: [
      { cell: 'control|home|mobile|browser|lcp_ms', provider: 'control', page: 'home', device: 'mobile', location: 'browser', metric: 'lcp_ms', unit: 'ms', current: 464, previous: null, best: 464, budget: 2500, budget_status: 'WITHIN_BUDGET', status: 'PASS', pct: null },
    ] }));
    writeFileSync(join(r, 'executive_summary.md'), '# Executive summary\n\nfirst run\n');
    writeFileSync(join(r, 'alerts.json'), JSON.stringify({ alerts: [] }));
    writeFileSync(join(r, 'providers/control/status.json'), JSON.stringify({ status: 'IMPLEMENTED_AND_VERIFIED', summary: 'browser home: HTTP 200', limitations: 'edge challenged', error: null }));
    writeFileSync(join(r, 'provider_status.snapshot.json'), JSON.stringify({ providers: [{ id: 'control', name: 'Control', status: 'IMPLEMENTED_AND_VERIFIED', credentials: 'none', notes: '' }] }));
  }
  return d;
}

describe('deriveHealth reads the scheduler state honestly', () => {
  const base = { lastAttemptAt: null, lastSuccessAt: '2026-09-13T06:52:00Z', lastSuccessRunId: 'r', nextDueAt: '2026-09-23T06:52:00Z', retryCount: 0, cycleFailed: false, lastTickAt: '2026-09-14T02:43:00Z', history: [] };
  it('is HEALTHY inside the interval with a live tick', () => expect(deriveHealth(base, NOW).status).toBe('HEALTHY'));
  it('is DUE once next_due_at has passed', () => expect(deriveHealth({ ...base, nextDueAt: '2026-09-14T08:00:00Z' }, NOW).status).toBe('DUE'));
  it('is RETRYING / CYCLE_FAILED from the retry fields', () => {
    expect(deriveHealth({ ...base, retryCount: 2 }, NOW).status).toBe('RETRYING');
    expect(deriveHealth({ ...base, retryCount: 4, cycleFailed: true }, NOW).status).toBe('CYCLE_FAILED');
  });
  it('is STALE after twelve days without success even when the tick is alive', () => expect(deriveHealth({ ...base, lastTickAt: '2026-09-25T02:43:00Z' }, new Date('2026-09-26T00:00:00Z')).status).toBe('STALE'));
  it('is SCHEDULER_SILENT when the host tick is older than 30 h — a dead timer never says HEALTHY', () => {
    expect(deriveHealth({ ...base, lastTickAt: '2026-09-12T02:43:00Z' }, NOW).status).toBe('SCHEDULER_SILENT');
  });
  it('is NEVER_RAN without state', () => expect(deriveHealth(null, NOW).status).toBe('NEVER_RAN'));
});

describe('validateRunRequestInput', () => {
  it('accepts a plain label and defaults to ad-hoc', () => expect(validateRunRequestInput({ label: 'Post-Cloudflare-2026-09-20', kind: '' })).toEqual({ ok: true, label: 'post-cloudflare-2026-09-20', kind: 'ad-hoc' }));
  it('refuses the protected baseline label, bad characters and unknown kinds', () => {
    expect(validateRunRequestInput({ label: 'pre-cloudflare-baseline', kind: 'ad-hoc' })).toMatchObject({ ok: false, code: 'RESERVED_LABEL' });
    expect(validateRunRequestInput({ label: 'has space', kind: 'ad-hoc' })).toMatchObject({ ok: false, code: 'BAD_LABEL' });
    expect(validateRunRequestInput({ label: 'x', kind: 'heavy' })).toMatchObject({ ok: false, code: 'BAD_KIND' });
    expect(validateRunRequestInput({ label: 'x'.repeat(62), kind: 'ad-hoc' })).toMatchObject({ ok: false, code: 'BAD_LABEL' });
  });
});

describe('overview + run detail through the filesystem store', () => {
  it('reports NOT_CONFIGURED when the directory is not mounted, with nothing invented', async () => {
    const ov = await new GetPerformanceAuditOverviewUseCase(new FilesystemPerformanceAuditStore('/nonexistent/perf-audit')).execute(NOW);
    expect(ov.configured).toBe(false);
    expect(ov.health.status).toBe('NOT_CONFIGURED');
    expect(ov.runs).toEqual([]);
    expect(ov.latestRun).toBeNull();
  });

  it('reads state, the latest run and the provider matrix from the host layout', async () => {
    const store = new FilesystemPerformanceAuditStore(dataDir());
    const ov = await new GetPerformanceAuditOverviewUseCase(store).execute(NOW);
    expect(ov.configured).toBe(true);
    expect(ov.health.status).toBe('HEALTHY');
    expect(ov.state?.lastTickAt).toBe('2026-09-14T02:43:00Z');
    expect(ov.latestRun?.runId).toBe('20260913T065047Z');
    expect(ov.latestRun?.providers.gtmetrix).toBe('IMPLEMENTED_AWAITING_CREDENTIALS');
    expect(ov.providerMatrix?.[0].id).toBe('control');
    const run = await new GetPerformanceAuditRunUseCase(store).execute('20260913T065047Z');
    expect(run?.rows[0].metric).toBe('lcp_ms');
    expect(run?.providerSummaries.control.limitations).toBe('edge challenged');
    expect(run?.executiveSummaryMd).toContain('first run');
  });

  it('never resolves a run id that is not a UTC stamp (no path traversal)', async () => {
    const store = new FilesystemPerformanceAuditStore(dataDir());
    expect(await new GetPerformanceAuditRunUseCase(store).execute('../state')).toBeNull();
    expect(await new GetPerformanceAuditRunUseCase(store).execute('20260913T065047Z/../..')).toBeNull();
  });
});

describe('RequestPerformanceAuditRunUseCase — the only write, guarded', () => {
  it('queues a request file the host watcher understands', async () => {
    const d = dataDir();
    const uc = new RequestPerformanceAuditRunUseCase(new FilesystemPerformanceAuditStore(d));
    const r = await uc.execute({ label: 'admin-check', kind: 'ad-hoc', actorId: 'user-1' }, NOW);
    expect(r.ok).toBe(true);
    const files = readdirSync(join(d, 'requests/queue')).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const body = JSON.parse(readFileSync(join(d, 'requests/queue', files[0]), 'utf8'));
    expect(body).toMatchObject({ label: 'admin-check', kind: 'ad-hoc', requestedBy: 'user-1', status: 'queued' });
    expect(body.heavy).toBeUndefined();
  });

  it('refuses a second request while one is queued or processing', async () => {
    const d = dataDir();
    const uc = new RequestPerformanceAuditRunUseCase(new FilesystemPerformanceAuditStore(d));
    expect((await uc.execute({ label: 'a', kind: 'ad-hoc', actorId: 'u' }, NOW)).ok).toBe(true);
    const second = await uc.execute({ label: 'b', kind: 'ad-hoc', actorId: 'u' }, NOW);
    expect(second).toMatchObject({ ok: false, code: 'ALREADY_QUEUED', status: 409 });
  });

  it('rate-limits back-office runs to six per rolling 24 h, counting done requests', async () => {
    const d = dataDir();
    for (let i = 0; i < MAX_ADMIN_RUNS_PER_DAY; i++) {
      writeFileSync(join(d, 'requests/done', `r${i}.json`), JSON.stringify({ id: `r${i}`, label: `l${i}`, kind: 'ad-hoc', requestedBy: 'u', requestedAt: new Date(NOW.getTime() - i * 3600_000).toISOString(), status: 'done', runId: 'x', outcome: 'SUCCESS' }));
    }
    const uc = new RequestPerformanceAuditRunUseCase(new FilesystemPerformanceAuditStore(d));
    expect(await uc.execute({ label: 'seven', kind: 'ad-hoc', actorId: 'u' }, NOW)).toMatchObject({ ok: false, code: 'RATE_LIMITED', status: 429 });
    // a day later the window has passed
    expect((await uc.execute({ label: 'later', kind: 'ad-hoc', actorId: 'u' }, new Date(NOW.getTime() + 25 * 3600_000))).ok).toBe(true);
  });

  it('refuses when the data directory is not mounted', async () => {
    const uc = new RequestPerformanceAuditRunUseCase(new FilesystemPerformanceAuditStore('/nonexistent/perf-audit'));
    expect(await uc.execute({ label: 'x', kind: 'ad-hoc', actorId: 'u' }, NOW)).toMatchObject({ ok: false, code: 'NOT_CONFIGURED', status: 503 });
  });
});
