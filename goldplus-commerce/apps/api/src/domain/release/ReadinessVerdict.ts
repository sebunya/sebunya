/**
 * The overall verdict of a release-readiness run, from its gate results.
 *
 * PASS means every check RAN and passed. A check that did not run
 * (NOT_CONFIGURED, UNKNOWN) is not a pass: before this existed, a run whose
 * checks all came back NOT_CONFIGURED was recorded PASS, and the admin banner
 * read "READY: All safe checks passed" for a run that had checked nothing.
 *
 *   any FAIL or BLOCKED                 → FAIL
 *   else any WARN                       → WARN
 *   else any NOT_CONFIGURED / UNKNOWN   → UNKNOWN
 *   else at least one PASS              → PASS   (NOT_APPLICABLE is neutral)
 *   else (nothing ran at all)           → UNKNOWN
 */
export type GateStatus = 'PASS' | 'FAIL' | 'WARN' | 'NOT_CONFIGURED' | 'NOT_APPLICABLE' | 'BLOCKED' | 'UNKNOWN';
export type RunVerdict = 'PASS' | 'FAIL' | 'WARN' | 'UNKNOWN';

export function readinessVerdict(statuses: readonly GateStatus[]): RunVerdict {
  if (statuses.some((s) => s === 'FAIL' || s === 'BLOCKED')) return 'FAIL';
  if (statuses.some((s) => s === 'WARN')) return 'WARN';
  if (statuses.some((s) => s === 'NOT_CONFIGURED' || s === 'UNKNOWN')) return 'UNKNOWN';
  return statuses.some((s) => s === 'PASS') ? 'PASS' : 'UNKNOWN';
}
