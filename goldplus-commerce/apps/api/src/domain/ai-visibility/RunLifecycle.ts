/**
 * Run lifecycle. A run fans out (query x provider) tasks; each task ends
 * SUCCEEDED, FAILED or SKIPPED (budget/cancel). One provider failing never
 * discards the others' evidence: the run is PARTIAL, not FAILED.
 */
export type RunStatus = 'AWAITING_APPROVAL' | 'QUEUED' | 'RUNNING' | 'PARTIAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'REJECTED';
export type TaskStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

export const TERMINAL: ReadonlySet<RunStatus> = new Set(['PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED', 'REJECTED']);

export interface TaskCounts { total: number; succeeded: number; failed: number; skipped: number; pending: number }

/** The terminal status once no task is pending. */
export function finalStatus(c: TaskCounts, cancelled: boolean): RunStatus {
  if (c.pending > 0) return 'RUNNING';
  if (cancelled && c.succeeded === 0) return 'CANCELLED';
  if (c.succeeded === 0) return 'FAILED';
  if (c.failed > 0 || c.skipped > 0 || cancelled) return 'PARTIAL';
  return 'COMPLETED';
}

const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  AWAITING_APPROVAL: ['QUEUED', 'REJECTED', 'CANCELLED'],
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED'],
  PARTIAL: [], COMPLETED: [], FAILED: [], CANCELLED: [], REJECTED: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Retry policy for one provider call: exponential backoff with a cap. */
export function backoffMs(attempt: number, baseMs = 1000, capMs = 20_000): number {
  return Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

/** Errors worth retrying: rate limits, timeouts and 5xx. A 4xx config error is not. */
export function isRetryable(status: number | null, code?: string): boolean {
  if (code === 'TIMEOUT' || code === 'NETWORK') return true;
  if (status == null) return false;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}
