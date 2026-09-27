/**
 * Why a payment attempt failed, as the provider said it (migration 0162).
 *
 * Pure rules, no I/O: the verification use case decides WHETHER a reason is
 * recorded, the repository writes it, and the admin queue maps the read side.
 */

/** Longest provider description we keep. Pesapal's are short; this bounds a hostile/garbled one. */
export const MAX_FAILURE_DESCRIPTION_LENGTH = 255;

/** Attempt states that are a non-paid terminal answer from the provider. */
const FAILED_TERMINAL_STATUSES = new Set(['failed', 'invalid', 'reversed', 'cancelled']);

export interface FailureReasonRecord {
  providerStatusCode: number | null;
  providerStatusDescription: string | null;
  failedAt: Date;
}

export function normaliseFailureDescription(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.slice(0, MAX_FAILURE_DESCRIPTION_LENGTH);
}

/**
 * The failure reason to persist, or null when none may be written.
 * A completed attempt is never touched: its money arrived, and a late or
 * sibling decline must not paint it as failed.
 */
export function failureReasonToRecord(input: {
  currentStatus: string;
  resolvedStatus: string;
  statusCode: unknown;
  description: unknown;
  now?: Date;
}): FailureReasonRecord | null {
  if (input.currentStatus === 'completed') return null;
  if (!FAILED_TERMINAL_STATUSES.has(input.resolvedStatus)) return null;
  const code = typeof input.statusCode === 'number' && Number.isInteger(input.statusCode) ? input.statusCode : null;
  return {
    providerStatusCode: code,
    providerStatusDescription: normaliseFailureDescription(input.description),
    failedAt: input.now ?? new Date(),
  };
}

export interface AttemptNumbering {
  id: string;
  attemptNumber: number;
  attemptsForOrder: number;
}

/** Attach per-order attempt numbering (computed in SQL) to queue rows by attempt id. */
export function withAttemptNumbers<T extends { id: string }>(
  rows: T[],
  numbering: AttemptNumbering[],
): Array<T & { attemptNumber: number | null; attemptsForOrder: number | null }> {
  const byId = new Map(numbering.map((n) => [n.id, n]));
  return rows.map((r) => {
    const n = byId.get(r.id);
    return { ...r, attemptNumber: n?.attemptNumber ?? null, attemptsForOrder: n?.attemptsForOrder ?? null };
  });
}

/** Count failed attempts by recorded description, most frequent first. */
export function summariseFailureReasons(
  rows: Array<{ status: string; providerStatusDescription?: string | null }>,
): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!FAILED_TERMINAL_STATUSES.has(r.status)) continue;
    const reason = r.providerStatusDescription ?? 'No reason recorded';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/** Read mapping for the admin queue: a reason is shown only for a failed attempt. */
export function failureFields(a: {
  status: string;
  providerStatusCode?: number | null;
  providerStatusDescription?: string | null;
  failedAt?: Date | null;
}): { failureReason: string | null; providerStatusCode: number | null; failedAt: Date | null } {
  if (!FAILED_TERMINAL_STATUSES.has(a.status)) return { failureReason: null, providerStatusCode: null, failedAt: null };
  return {
    failureReason: a.providerStatusDescription ?? null,
    providerStatusCode: a.providerStatusCode ?? null,
    failedAt: a.failedAt ?? null,
  };
}
