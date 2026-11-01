import { randomUUID } from 'node:crypto';
import type {
  IPerformanceAuditStore,
  PerformanceAuditRequestKind,
  PerformanceAuditRunDetail,
  PerformanceAuditRunRequest,
  PerformanceAuditRunSummary,
  PerformanceAuditSchedulerState,
} from '../../ports/IPerformanceAuditStore';

/**
 * Continuous Performance Assurance — admin use cases (2026-09-13).
 *
 * Reads the audit's data directory through the store port and lets an
 * authorised operator REQUEST a run. The request is a file in a queue that a
 * host-side watcher drains; nothing here executes the audit, touches Docker,
 * or generates traffic. The guard rails live here, not in the route:
 *   - labels are short, lower-case, and cannot claim the protected baseline name;
 *   - one request in flight at a time;
 *   - a bounded number of admin-triggered runs per rolling 24 hours, so the
 *     back office cannot turn a 2-vCPU production host into a load generator;
 *   - "recurring-now" (advances the ten-day clock) must be asked for explicitly.
 */

export const RUN_REQUEST_LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,60}$/;
export const RESERVED_LABEL_PREFIXES = ['pre-cloudflare-baseline'];
export const MAX_ADMIN_RUNS_PER_DAY = 6;
export const STALE_AFTER_DAYS = 12;
export const TICK_STALE_AFTER_HOURS = 30;

export interface PerformanceAuditOverview {
  configured: boolean;
  state: PerformanceAuditSchedulerState | null;
  /** Derived, never invented: what the scheduler state says about health. */
  health: {
    status: 'HEALTHY' | 'DUE' | 'RETRYING' | 'CYCLE_FAILED' | 'STALE' | 'SCHEDULER_SILENT' | 'NEVER_RAN' | 'NOT_CONFIGURED';
    detail: string;
  };
  latestRun: PerformanceAuditRunSummary | null;
  runs: PerformanceAuditRunSummary[];
  requests: PerformanceAuditRunRequest[];
  inFlight: PerformanceAuditRunRequest | null;
  runsRequestedLast24h: number;
  maxRunsPerDay: number;
  providerMatrix: Array<{ id: string; name: string; status: string; credentials: string; notes: string }> | null;
}

export function deriveHealth(state: PerformanceAuditSchedulerState | null, now: Date): PerformanceAuditOverview['health'] {
  if (!state) return { status: 'NEVER_RAN', detail: 'No scheduler state exists yet: no recurring audit has run.' };
  const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
  const tickAge = ms(state.lastTickAt);
  if (Number.isFinite(tickAge) && now.getTime() - tickAge > TICK_STALE_AFTER_HOURS * 3600_000) {
    return { status: 'SCHEDULER_SILENT', detail: `The host scheduler last checked in at ${state.lastTickAt}; the daily tick has not run for more than ${TICK_STALE_AFTER_HOURS} hours.` };
  }
  if (!state.lastSuccessAt) {
    if (state.cycleFailed) return { status: 'CYCLE_FAILED', detail: 'The first cycle failed after every retry; the next attempt waits a full interval.' };
    if (state.retryCount > 0) return { status: 'RETRYING', detail: `The first cycle failed ${state.retryCount} time(s); a retry is scheduled.` };
    return { status: 'NEVER_RAN', detail: 'No recurring audit has succeeded yet.' };
  }
  const successAge = now.getTime() - ms(state.lastSuccessAt);
  if (successAge > STALE_AFTER_DAYS * 86400_000) {
    return { status: 'STALE', detail: `The last successful audit was ${Math.floor(successAge / 86400_000)} days ago (limit ${STALE_AFTER_DAYS}).` };
  }
  if (state.cycleFailed) return { status: 'CYCLE_FAILED', detail: 'The last cycle failed after every retry; the next attempt waits a full interval from the last attempt.' };
  if (state.retryCount > 0) return { status: 'RETRYING', detail: `The current cycle has failed ${state.retryCount} time(s); the next retry is due ${state.nextDueAt ?? 'soon'}.` };
  if (state.nextDueAt && ms(state.nextDueAt) <= now.getTime()) return { status: 'DUE', detail: `An audit is due (since ${state.nextDueAt}); it runs at the next daily tick.` };
  return { status: 'HEALTHY', detail: `Last success ${state.lastSuccessAt}; next audit due ${state.nextDueAt ?? 'unknown'}.` };
}

export type RequestRunResult =
  | { ok: true; request: PerformanceAuditRunRequest }
  | { ok: false; code: 'NOT_CONFIGURED' | 'BAD_LABEL' | 'RESERVED_LABEL' | 'BAD_KIND' | 'ALREADY_QUEUED' | 'RATE_LIMITED' | 'QUEUE_UNAVAILABLE'; message: string; status: number };

export function validateRunRequestInput(input: { label: unknown; kind: unknown }): { ok: true; label: string; kind: PerformanceAuditRequestKind } | { ok: false; code: 'BAD_LABEL' | 'RESERVED_LABEL' | 'BAD_KIND'; message: string } {
  const label = String(input.label ?? '').trim().toLowerCase();
  if (!RUN_REQUEST_LABEL_PATTERN.test(label)) {
    return { ok: false, code: 'BAD_LABEL', message: 'Label must be 1–61 characters of a–z, 0–9, dot, underscore or dash, starting with a letter or digit.' };
  }
  if (RESERVED_LABEL_PREFIXES.some((p) => label.startsWith(p))) {
    return { ok: false, code: 'RESERVED_LABEL', message: 'That label is reserved for the protected baseline run.' };
  }
  const kind = input.kind === undefined || input.kind === null || input.kind === '' ? 'ad-hoc' : input.kind;
  if (kind !== 'ad-hoc' && kind !== 'recurring-now') {
    return { ok: false, code: 'BAD_KIND', message: "kind must be 'ad-hoc' (does not move the ten-day clock) or 'recurring-now' (counts as the scheduled audit)." };
  }
  return { ok: true, label, kind };
}

export function countRequestsInWindow(requests: PerformanceAuditRunRequest[], now: Date, windowMs = 86400_000): number {
  return requests.filter((r) => Number.isFinite(Date.parse(r.requestedAt)) && now.getTime() - Date.parse(r.requestedAt) <= windowMs && r.status !== 'failed').length;
}

export class GetPerformanceAuditOverviewUseCase {
  constructor(private readonly store: IPerformanceAuditStore) {}

  async execute(now: Date = new Date()): Promise<PerformanceAuditOverview> {
    const configured = await this.store.isConfigured();
    if (!configured) {
      return {
        configured: false, state: null,
        health: { status: 'NOT_CONFIGURED', detail: 'The audit data directory is not mounted into the API (PERFORMANCE_AUDIT_DATA_DIR). Reports are still produced on the host; see performance-audit/README.md.' },
        latestRun: null, runs: [], requests: [], inFlight: null, runsRequestedLast24h: 0, maxRunsPerDay: MAX_ADMIN_RUNS_PER_DAY, providerMatrix: null,
      };
    }
    const [state, runs, requests, providerMatrix] = await Promise.all([
      this.store.readState(), this.store.listRuns(30), this.store.listRequests(), this.store.readProviderMatrix(),
    ]);
    const inFlight = requests.find((r) => r.status === 'queued' || r.status === 'processing') ?? null;
    return {
      configured: true, state, health: deriveHealth(state, now), latestRun: runs[0] ?? null, runs, requests,
      inFlight, runsRequestedLast24h: countRequestsInWindow(requests, now), maxRunsPerDay: MAX_ADMIN_RUNS_PER_DAY, providerMatrix,
    };
  }
}

export class GetPerformanceAuditRunUseCase {
  constructor(private readonly store: IPerformanceAuditStore) {}

  async execute(runId: string): Promise<PerformanceAuditRunDetail | null> {
    if (!/^\d{8}T\d{6}Z$/.test(runId)) return null; // run ids are UTC stamps; anything else never touches the filesystem
    if (!(await this.store.isConfigured())) return null;
    return this.store.readRun(runId);
  }
}

export class RequestPerformanceAuditRunUseCase {
  constructor(private readonly store: IPerformanceAuditStore) {}

  async execute(input: { label: unknown; kind: unknown; actorId: string }, now: Date = new Date()): Promise<RequestRunResult> {
    if (!(await this.store.isConfigured())) {
      return { ok: false, code: 'NOT_CONFIGURED', message: 'The audit data directory is not mounted into the API; requests cannot be queued.', status: 503 };
    }
    const v = validateRunRequestInput(input);
    if (!v.ok) return { ok: false, code: v.code, message: v.message, status: 400 };
    const requests = await this.store.listRequests();
    const inFlight = requests.find((r) => r.status === 'queued' || r.status === 'processing');
    if (inFlight) {
      return { ok: false, code: 'ALREADY_QUEUED', message: `A run is already ${inFlight.status} (label "${inFlight.label}", requested ${inFlight.requestedAt}). One at a time.`, status: 409 };
    }
    const recent = countRequestsInWindow(requests, now);
    if (recent >= MAX_ADMIN_RUNS_PER_DAY) {
      return { ok: false, code: 'RATE_LIMITED', message: `${recent} runs were requested from the back office in the last 24 hours (limit ${MAX_ADMIN_RUNS_PER_DAY}). The host is production; wait for the window to pass.`, status: 429 };
    }
    const request: PerformanceAuditRunRequest = {
      id: `${now.toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z-${randomUUID().slice(0, 8)}`,
      kind: v.kind, label: v.label, requestedBy: input.actorId, requestedAt: now.toISOString(), status: 'queued',
    };
    try {
      await this.store.enqueueRequest(request);
    } catch (e) {
      return { ok: false, code: 'QUEUE_UNAVAILABLE', message: `The request queue is not writable from the API: ${(e as Error).message}`, status: 503 };
    }
    return { ok: true, request };
  }
}
