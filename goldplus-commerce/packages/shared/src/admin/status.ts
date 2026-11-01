import type { MetricState } from '../analytics/contracts';

/**
 * Operational status for an admin SURFACE.
 *
 * This is deliberately a different question from `MetricState` in
 * analytics/contracts.ts, and the two must not be merged or duplicated:
 *
 *   MetricState  describes the EVIDENCE behind a number — can this metric be
 *                reported, and if not, why. It is the canonical vocabulary for
 *                anything numeric and is not redefined here.
 *   AdminStatus  describes the HEALTH of a surface or dependency — is this
 *                thing working, and if not, what kind of not-working.
 *
 * They overlap on NO_DATA and STALE because those words mean the same thing in
 * both. `fromMetricState` below is the single projection between them, so a
 * metric's evidence state can drive a surface badge without either vocabulary
 * being restated.
 *
 * One status vocabulary for the whole admin control plane.
 *
 * The defect this exists to prevent is specific and common: a dashboard
 * rendering HEALTHY because `failed === 0`, when nothing has ever run. Zero
 * failures out of zero attempts is not health — it is an absence of evidence,
 * and an operator who reads it as health will not investigate the thing that
 * silently stopped working.
 *
 * These states are deliberately NOT interchangeable:
 *
 *   ZERO            a calculation succeeded and the answer is genuinely zero
 *   NO_DATA         the feature works, but no qualifying observations exist
 *   UNKNOWN         evidence is insufficient to say
 *   SETUP_REQUIRED  an external dependency is missing
 *   FAILED          execution was attempted and failed
 *   STALE           data exists but is older than its freshness contract
 *   DISABLED        switched off by policy, not broken
 *   READ_ONLY       working as designed, deliberately not writable
 *   DEGRADED        working, but below its contract
 *   HEALTHY         a successful operation happened, recently enough to count
 */

export const ADMIN_STATUS = [
  'HEALTHY', 'DEGRADED', 'FAILED', 'NO_DATA', 'STALE',
  'SETUP_REQUIRED', 'DISABLED_BY_POLICY', 'READ_ONLY', 'UNKNOWN',
] as const;
export type AdminStatus = (typeof ADMIN_STATUS)[number];

export interface AdminStatusView {
  status: AdminStatus;
  /** Short operator-facing label. */
  label: string;
  /** Why this status — never decorative, always the deciding evidence. */
  reason: string;
  /** What the operator can do about it, when there is something to do. */
  action?: string;
}

/** Inputs a health decision may legitimately consider. */
export interface HealthEvidence {
  /** Is the dependency reachable at all? Undefined means not checked. */
  available?: boolean;
  /** When the last SUCCESSFUL operation completed. */
  lastSuccessAt?: string | Date | null;
  /** When the last attempt was made, successful or not. */
  lastAttemptAt?: string | Date | null;
  /** Whether the last attempt failed, and why. */
  lastError?: string | null;
  /** Observations in the current window. */
  observed?: number;
  /** How old data may be before it is STALE, in ms. */
  freshnessMs?: number;
  /** Set when an external credential/config is genuinely absent. */
  setupRequired?: boolean;
  /** Set when an operator or policy switched this off. */
  disabledByPolicy?: boolean;
  /** Set when the surface is intentionally not writable. */
  readOnly?: boolean;
  nowMs?: number;
}

const toMs = (v: string | Date | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};

/**
 * Derive a status from evidence.
 *
 * Order matters and encodes the precedence an operator needs: a deliberate
 * policy decision outranks a missing credential, which outranks a failure,
 * which outranks staleness. Health is LAST and must be earned — it requires a
 * successful operation to point at.
 */
export function deriveAdminStatus(e: HealthEvidence): AdminStatusView {
  const now = e.nowMs ?? Date.now();

  if (e.disabledByPolicy) {
    return { status: 'DISABLED_BY_POLICY', label: 'Disabled',
      reason: 'Switched off by policy. This is a decision, not a fault.' };
  }
  if (e.setupRequired) {
    return { status: 'SETUP_REQUIRED', label: 'Setup required',
      reason: 'An external dependency has not been configured yet.',
      action: 'Complete the connection to start collecting.' };
  }
  if (e.available === false) {
    return { status: 'FAILED', label: 'Unavailable',
      reason: 'The dependency could not be reached.' };
  }
  if (e.lastError) {
    return { status: 'FAILED', label: 'Failed',
      reason: `The last attempt failed: ${String(e.lastError).slice(0, 160)}` };
  }

  const lastSuccess = toMs(e.lastSuccessAt);
  const lastAttempt = toMs(e.lastAttemptAt);

  // Never succeeded. This is the case that most often gets mislabelled as
  // healthy, because there are no failures to count.
  if (lastSuccess === null) {
    if (lastAttempt !== null) {
      return { status: 'DEGRADED', label: 'No successful run',
        reason: 'It has been attempted but has never completed successfully.' };
    }
    return { status: 'NO_DATA', label: 'No data yet',
      reason: 'This has never run, so there is nothing to report. That is not the same as a healthy zero.' };
  }

  if (e.freshnessMs && now - lastSuccess > e.freshnessMs) {
    const hours = Math.floor((now - lastSuccess) / 3_600_000);
    return { status: 'STALE', label: 'Stale',
      reason: `The last successful run was ${hours}h ago, beyond the freshness window.` };
  }

  if (e.readOnly) {
    return { status: 'READ_ONLY', label: 'Read only',
      reason: 'Working as designed; this surface is deliberately not writable.' };
  }

  // A successful, recent run WITH no observations is healthy pipeline and
  // empty activity — two different facts, reported as one status plus an
  // honest reason rather than collapsed into "healthy".
  if (e.observed === 0) {
    return { status: 'HEALTHY', label: 'Healthy · no activity',
      reason: 'The last run succeeded. It observed nothing in this window, which is an absence of activity, not an absence of health.' };
  }

  return { status: 'HEALTHY', label: 'Healthy',
    reason: e.observed === undefined
      ? 'The last run completed successfully within the freshness window.'
      : `The last run completed successfully and observed ${e.observed} item(s).` };
}

/** Distinguishes a measured zero from an absence of measurement. */
export function countView(value: number | null | undefined, opts: { measured: boolean }): {
  display: string; status: AdminStatus; reason: string;
} {
  if (!opts.measured) {
    return { display: '—', status: 'NO_DATA',
      reason: 'Not measured. This is not zero.' };
  }
  if (value === null || value === undefined) {
    return { display: 'Unknown', status: 'UNKNOWN',
      reason: 'The measurement could not be established.' };
  }
  return { display: String(value), status: 'HEALTHY',
    reason: value === 0 ? 'Measured, and the answer is genuinely zero.' : 'Measured.' };
}

/** Tailwind classes per status. Colour follows meaning, not decoration. */
export function adminStatusClass(status: AdminStatus): string {
  switch (status) {
    case 'HEALTHY': return 'border-emerald-300 bg-emerald-50 text-emerald-900';
    case 'DEGRADED': return 'border-amber-300 bg-amber-50 text-amber-900';
    case 'FAILED': return 'border-red-300 bg-red-50 text-red-900';
    case 'STALE': return 'border-orange-300 bg-orange-50 text-orange-900';
    case 'SETUP_REQUIRED': return 'border-blue-300 bg-blue-50 text-blue-900';
    case 'DISABLED_BY_POLICY': return 'border-gray-300 bg-gray-100 text-gray-700';
    case 'READ_ONLY': return 'border-gray-300 bg-gray-50 text-gray-600';
    case 'NO_DATA': return 'border-gray-300 bg-gray-50 text-gray-500';
    default: return 'border-gray-300 bg-gray-50 text-gray-500';
  }
}


/**
 * Project a metric's evidence state onto a surface status.
 *
 * The mapping exists so admin surfaces can render an analytics metric without
 * inventing a second set of names for the same conditions. It is the ONLY
 * place the two vocabularies meet.
 */
export function fromMetricState(state: MetricState): AdminStatus {
  switch (state) {
    case 'VALUE': return 'HEALTHY';
    case 'NO_DATA': return 'NO_DATA';
    case 'STALE': return 'STALE';
    case 'PARTIAL': return 'DEGRADED';
    case 'SOURCE_UNAVAILABLE': return 'FAILED';
    case 'INSUFFICIENT_EVIDENCE': return 'UNKNOWN';
    case 'NOT_APPLICABLE': return 'DISABLED_BY_POLICY';
    default: return 'UNKNOWN';
  }
}
