/**
 * Performance audit store (2026-09-13).
 *
 * The Continuous Performance Assurance system (`performance-audit/`) runs on
 * the host, not in the API. The API only READS its data directory and WRITES
 * one kind of file: a run request. A host-side watcher picks the request up
 * and runs the audit; the API never talks to Docker and never runs a probe.
 * Every read is honest about absence: a data directory that is not mounted
 * means "not configured", never an empty dashboard pretending to be data.
 */

export interface PerformanceAuditSchedulerState {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastSuccessRunId: string | null;
  nextDueAt: string | null;
  retryCount: number;
  cycleFailed: boolean;
  /** Written by the daily tick even when nothing is due: proves the host scheduler is alive. */
  lastTickAt: string | null;
  history: Array<{ runId: string; kind: string; label: string | null; outcome: string; startedAt: string | null }>;
}

export interface PerformanceAuditRunSummary {
  runId: string;
  kind: string;
  label: string | null;
  outcome: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  repoSha: string | null;
  target: string | null;
  metricCount: number | null;
  providers: Record<string, string>;
  regressionCounts: Record<string, number>;
  previousRun: string | null;
}

export interface PerformanceAuditMetricRow {
  cell: string;
  provider: string;
  page: string;
  device: string;
  location: string;
  metric: string;
  unit: string;
  current: number | string | null;
  previous: number | string | null;
  best: number | string | null;
  budget: number | null;
  budgetStatus: string | null;
  status: string;
  pct: number | null;
}

export interface PerformanceAuditRunDetail extends PerformanceAuditRunSummary {
  executiveSummaryMd: string | null;
  regressionReportMd: string | null;
  engineeringReportMd: string | null;
  rows: PerformanceAuditMetricRow[];
  alerts: Array<{ kind: string; detail: string }>;
  providerSummaries: Record<string, { status: string; summary: string; limitations: string | null; error: string | null }>;
}

export type PerformanceAuditRequestKind = 'ad-hoc' | 'recurring-now';
export type PerformanceAuditRequestStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface PerformanceAuditRunRequest {
  id: string;
  kind: PerformanceAuditRequestKind;
  label: string;
  requestedBy: string;
  requestedAt: string;
  status: PerformanceAuditRequestStatus;
  runId?: string | null;
  outcome?: string | null;
  finishedAt?: string | null;
  message?: string | null;
}

export interface IPerformanceAuditStore {
  /** False when the data directory is not mounted into the API container. */
  isConfigured(): Promise<boolean>;
  readState(): Promise<PerformanceAuditSchedulerState | null>;
  listRuns(limit: number): Promise<PerformanceAuditRunSummary[]>;
  readRun(runId: string): Promise<PerformanceAuditRunDetail | null>;
  listRequests(): Promise<PerformanceAuditRunRequest[]>;
  /** Writes the request into the host-watched queue. Throws when the queue directory is not writable. */
  enqueueRequest(request: PerformanceAuditRunRequest): Promise<void>;
  /** Provider matrix as designed (provider_status.json in the repository), if mounted. */
  readProviderMatrix(): Promise<Array<{ id: string; name: string; status: string; credentials: string; notes: string }> | null>;
}
