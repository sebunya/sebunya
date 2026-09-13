import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  IPerformanceAuditStore,
  PerformanceAuditMetricRow,
  PerformanceAuditRunDetail,
  PerformanceAuditRunRequest,
  PerformanceAuditRunSummary,
  PerformanceAuditSchedulerState,
} from '../../application/ports/IPerformanceAuditStore';

/**
 * Reads the performance-audit data directory that the host bind-mounts into the
 * API container (PERFORMANCE_AUDIT_DATA_DIR, default /data/performance-audit)
 * and writes run requests into requests/queue/. Layout is owned by
 * performance-audit/run_all.sh and run_safe_recurring.sh:
 *
 *   state/schedule.json · state/last_tick_at · reports/<run>/manifest.json,
 *   regression.json, *.md, alerts.json, providers/<name>/status.json ·
 *   requests/{queue,processing,done}/<id>.json · provider_status.json (repo copy)
 *
 * Every read tolerates a missing or half-written file (the host may be writing
 * a run while the admin looks): it returns null or an empty list, never throws
 * into the route. Run ids are validated by the use case before they reach here.
 */
export class FilesystemPerformanceAuditStore implements IPerformanceAuditStore {
  constructor(private readonly dataDir: string = process.env.PERFORMANCE_AUDIT_DATA_DIR || '/data/performance-audit') {}

  private p(...parts: string[]): string { return join(this.dataDir, ...parts); }

  private async readJson<T>(path: string): Promise<T | null> {
    try { return JSON.parse(await fs.readFile(path, 'utf8')) as T; } catch { return null; }
  }

  private async readText(path: string, maxBytes = 512 * 1024): Promise<string | null> {
    try {
      const buf = await fs.readFile(path);
      return buf.length > maxBytes ? `${buf.subarray(0, maxBytes).toString('utf8')}\n\n… truncated (${buf.length} bytes)` : buf.toString('utf8');
    } catch { return null; }
  }

  async isConfigured(): Promise<boolean> {
    try { return (await fs.stat(this.p('reports'))).isDirectory(); } catch { return false; }
  }

  async readState(): Promise<PerformanceAuditSchedulerState | null> {
    const raw = await this.readJson<Record<string, unknown>>(this.p('state', 'schedule.json'));
    const tick = (await this.readText(this.p('state', 'last_tick_at'), 64))?.trim() || null;
    if (!raw && !tick) return null;
    const s = raw ?? {};
    const history = Array.isArray(s.history) ? (s.history as Array<Record<string, unknown>>) : [];
    return {
      lastAttemptAt: (s.last_attempt_at as string) ?? null,
      lastSuccessAt: (s.last_success_at as string) ?? null,
      lastSuccessRunId: (s.last_success_run_id as string) ?? null,
      nextDueAt: (s.next_due_at as string) ?? null,
      retryCount: Number(s.retry_count ?? 0) || 0,
      cycleFailed: Boolean(s.cycle_failed),
      lastTickAt: tick,
      history: history.slice(-20).map((h) => ({
        runId: String(h.run_id ?? ''), kind: String(h.kind ?? ''), label: (h.label as string) ?? null, outcome: String(h.outcome ?? ''), startedAt: (h.started_at as string) ?? null,
      })),
    };
  }

  private summaryFromManifest(runId: string, m: Record<string, unknown>): PerformanceAuditRunSummary {
    return {
      runId,
      kind: String(m.kind ?? 'unknown'),
      label: (m.label as string) ?? null,
      outcome: (m.outcome as string) ?? null,
      startedAt: (m.started_at as string) ?? null,
      finishedAt: (m.finished_at as string) ?? null,
      repoSha: (m.repo_sha as string) ?? null,
      target: (m.target as string) ?? null,
      metricCount: typeof m.metric_count === 'number' ? m.metric_count : null,
      providers: (m.providers && typeof m.providers === 'object' ? m.providers : {}) as Record<string, string>,
      regressionCounts: (m.regression_counts && typeof m.regression_counts === 'object' ? m.regression_counts : {}) as Record<string, number>,
      previousRun: (m.previous_run as string) ?? null,
    };
  }

  async listRuns(limit: number): Promise<PerformanceAuditRunSummary[]> {
    let names: string[] = [];
    try { names = (await fs.readdir(this.p('reports'))).filter((n) => /^\d{8}T\d{6}Z$/.test(n)).sort().reverse().slice(0, Math.max(1, limit)); } catch { return []; }
    const out: PerformanceAuditRunSummary[] = [];
    for (const runId of names) {
      const m = await this.readJson<Record<string, unknown>>(this.p('reports', runId, 'manifest.json'));
      if (m) out.push(this.summaryFromManifest(runId, m));
    }
    return out;
  }

  async readRun(runId: string): Promise<PerformanceAuditRunDetail | null> {
    const dir = this.p('reports', runId);
    if (resolve(dir) !== resolve(this.dataDir, 'reports', runId)) return null;
    const m = await this.readJson<Record<string, unknown>>(join(dir, 'manifest.json'));
    if (!m) return null;
    const summary = this.summaryFromManifest(runId, m);
    const reg = await this.readJson<{ rows?: Array<Record<string, unknown>> }>(join(dir, 'regression.json'));
    const rows: PerformanceAuditMetricRow[] = (reg?.rows ?? []).map((r) => ({
      cell: String(r.cell ?? ''), provider: String(r.provider ?? ''), page: String(r.page ?? ''), device: String(r.device ?? ''), location: String(r.location ?? ''),
      metric: String(r.metric ?? ''), unit: String(r.unit ?? ''), current: (r.current as number | string | null) ?? null, previous: (r.previous as number | string | null) ?? null,
      best: (r.best as number | string | null) ?? null, budget: typeof r.budget === 'number' ? r.budget : null, budgetStatus: (r.budget_status as string) ?? null,
      status: String(r.status ?? 'NO_DATA'), pct: typeof r.pct === 'number' ? r.pct : null,
    }));
    const alertsDoc = await this.readJson<{ alerts?: Array<{ kind: string; detail: string }> }>(join(dir, 'alerts.json'));
    const providerSummaries: PerformanceAuditRunDetail['providerSummaries'] = {};
    for (const name of Object.keys(summary.providers)) {
      if (!/^[a-z0-9_]+$/.test(name)) continue;
      const st = await this.readJson<Record<string, unknown>>(join(dir, 'providers', name, 'status.json'));
      if (st) providerSummaries[name] = { status: String(st.status ?? summary.providers[name]), summary: String(st.summary ?? ''), limitations: (st.limitations as string) ?? null, error: (st.error as string) ?? null };
    }
    return {
      ...summary,
      executiveSummaryMd: await this.readText(join(dir, 'executive_summary.md')),
      regressionReportMd: await this.readText(join(dir, 'regression_report.md')),
      engineeringReportMd: await this.readText(join(dir, 'engineering_report.md')),
      rows,
      alerts: alertsDoc?.alerts ?? [],
      providerSummaries,
    };
  }

  async listRequests(): Promise<PerformanceAuditRunRequest[]> {
    const out: PerformanceAuditRunRequest[] = [];
    for (const bucket of ['queue', 'processing', 'done'] as const) {
      let names: string[] = [];
      try { names = (await fs.readdir(this.p('requests', bucket))).filter((n) => n.endsWith('.json')); } catch { continue; }
      for (const n of names) {
        const r = await this.readJson<PerformanceAuditRunRequest>(this.p('requests', bucket, n));
        if (r && r.id) out.push({ ...r, status: bucket === 'queue' ? 'queued' : bucket === 'processing' ? 'processing' : (r.status === 'failed' ? 'failed' : 'done') });
      }
    }
    return out.sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1)).slice(0, 100);
  }

  async enqueueRequest(request: PerformanceAuditRunRequest): Promise<void> {
    if (!/^[A-Za-z0-9-]+$/.test(request.id)) throw new Error('bad request id');
    const dir = this.p('requests', 'queue');
    const tmp = join(dir, `.${request.id}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(request, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(tmp, join(dir, `${request.id}.json`));
  }

  async readProviderMatrix(): Promise<Array<{ id: string; name: string; status: string; credentials: string; notes: string }> | null> {
    // The latest run carries a snapshot of the repository's provider_status.json.
    const runs = await this.listRuns(1);
    if (!runs[0]) return null;
    const doc = await this.readJson<{ providers?: Array<Record<string, unknown>> }>(this.p('reports', runs[0].runId, 'provider_status.snapshot.json'));
    if (!doc?.providers) return null;
    return doc.providers.map((p) => ({ id: String(p.id ?? ''), name: String(p.name ?? ''), status: String(p.status ?? ''), credentials: String(p.credentials ?? ''), notes: String(p.notes ?? '') }));
  }
}
