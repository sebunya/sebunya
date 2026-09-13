// Durable scheduler state: rolling ten-day due gate, bounded retries, atomic writes.
// State file: $PERF_AUDIT_DATA_DIR/state/schedule.json
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const TEN_DAYS_SECONDS = 864000;

export const EMPTY_STATE = Object.freeze({
  version: 1,
  last_attempt_at: null,      // ISO UTC of the last recurring attempt (ad-hoc runs never touch this)
  last_success_at: null,      // ISO UTC of the last SUCCESS or PARTIAL_SUCCESS recurring run
  last_success_run_id: null,
  next_due_at: null,          // ISO UTC; informational — the gate below is the truth
  retry_count: 0,             // failed attempts since the last success
  cycle_failed: false,        // retries exhausted; waits for the next 10-day boundary or a manual run
  best_run_id: null,          // historical best (see compare_runs.py)
  history: [],                // [{run_id, label, kind, outcome, started_at}] newest last, bounded
});

export function readState(path) {
  if (!existsSync(path)) return { ...EMPTY_STATE, history: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return { ...EMPTY_STATE, ...parsed, history: Array.isArray(parsed.history) ? parsed.history : [] };
  } catch (e) {
    // A corrupted file must never be silently replaced: keep it for inspection and start clean.
    const backup = `${path}.corrupt-${Date.now()}`;
    try { renameSync(path, backup); } catch { /* ignore */ }
    return { ...EMPTY_STATE, history: [], corrupted_backup: backup };
  }
}

/** Atomic: write to a temp file, fsync-free rename. A crash mid-write leaves the old file intact. */
export function writeState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, path);
}

const iso = (ms) => new Date(ms).toISOString();

/**
 * Is a recurring audit due? Pure. `now` is epoch ms.
 *  - never succeeded → due now
 *  - retries pending → due at last_attempt + retry delay
 *  - cycle failed (retries exhausted) → due at last_success + interval (never hourly hammering)
 *  - otherwise → due at last_success + interval
 */
export function computeDue(state, now, cfg) {
  const interval = (cfg.interval_seconds ?? TEN_DAYS_SECONDS) * 1000;
  const delays = (cfg.retry_delays_seconds ?? [21600, 43200, 86400]).map((s) => s * 1000);
  const lastSuccess = state.last_success_at ? Date.parse(state.last_success_at) : null;
  const lastAttempt = state.last_attempt_at ? Date.parse(state.last_attempt_at) : null;
  if (lastSuccess === null) {
    if (lastAttempt !== null && state.retry_count > 0 && !state.cycle_failed) {
      const d = lastAttempt + delays[Math.min(state.retry_count - 1, delays.length - 1)];
      return { due: now >= d, dueAt: iso(d), reason: `retry ${state.retry_count} after a failed first cycle` };
    }
    if (state.cycle_failed) return { due: lastAttempt === null || now >= lastAttempt + interval, dueAt: iso((lastAttempt ?? now) + interval), reason: 'first cycle failed after all retries; waiting a full interval' };
    return { due: true, dueAt: iso(now), reason: 'no successful audit yet' };
  }
  if (state.retry_count > 0 && !state.cycle_failed && lastAttempt !== null) {
    const d = lastAttempt + delays[Math.min(state.retry_count - 1, delays.length - 1)];
    return { due: now >= d, dueAt: iso(d), reason: `retry ${state.retry_count} of ${delays.length}` };
  }
  if (state.cycle_failed && lastAttempt !== null) {
    // Retries exhausted: wait a full interval from the LAST ATTEMPT, so an exhausted cycle never re-fires at every daily tick.
    const d = lastAttempt + interval;
    return { due: now >= d, dueAt: iso(d), reason: 'previous cycle failed after all retries; next full interval from the last attempt' };
  }
  const d = lastSuccess + interval;
  return { due: now >= d, dueAt: iso(d), reason: 'rolling interval from last success' };
}

/** Record the start of a RECURRING attempt (ad-hoc runs do not call this). */
export function markAttempt(state, now) {
  return { ...state, last_attempt_at: iso(now) };
}

/** Record the outcome of a recurring attempt. SUCCESS and PARTIAL_SUCCESS advance the clock; FAILED does not. */
export function markOutcome(state, now, { outcome, runId, cfg }) {
  const interval = (cfg.interval_seconds ?? TEN_DAYS_SECONDS) * 1000;
  const maxRetries = (cfg.retry_delays_seconds ?? [1, 1, 1]).length;
  if (outcome === 'SUCCESS' || outcome === 'PARTIAL_SUCCESS') {
    return { ...state, last_success_at: iso(now), last_success_run_id: runId, next_due_at: iso(now + interval), retry_count: 0, cycle_failed: false };
  }
  const retry = state.retry_count + 1;
  if (retry > maxRetries) return { ...state, retry_count: retry, cycle_failed: true, next_due_at: iso(now + interval) };
  const delays = (cfg.retry_delays_seconds ?? [21600, 43200, 86400]).map((s) => s * 1000);
  return { ...state, retry_count: retry, cycle_failed: false, next_due_at: iso(now + delays[Math.min(retry - 1, delays.length - 1)]) };
}

export function appendHistory(state, entry, keep = 200) {
  const history = [...state.history, entry].slice(-keep);
  return { ...state, history };
}

/** Outcome from provider results: SUCCESS all ok; PARTIAL if some failed but core measurements exist; FAILED otherwise. */
export function classifyOutcome(providerStatuses, coreProviders = ['control']) {
  const ok = (s) => s === 'IMPLEMENTED_AND_VERIFIED';
  const soft = (s) => ['IMPLEMENTED_AWAITING_CREDENTIALS', 'IMPLEMENTED_AWAITING_SUBSCRIPTION', 'SKIPPED_FOR_SAFETY', 'UNSUPPORTED_BY_CURRENT_PROVIDER', 'BLOCKED_BY_PROVIDER', 'DISABLED'].includes(s);
  const entries = Object.entries(providerStatuses);
  const coreOk = coreProviders.every((p) => ok(providerStatuses[p]));
  if (!coreOk) return 'FAILED';
  const failures = entries.filter(([, s]) => !ok(s) && !soft(s)).length;
  return failures === 0 ? 'SUCCESS' : 'PARTIAL_SUCCESS';
}
