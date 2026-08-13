/**
 * Turning a stored cadence into actual behaviour.
 *
 * The GSC connection carried `sync_frequency = DAILY` from the moment it was
 * created, and nothing ever ran. The cadence was configuration that no
 * scheduler read — the connection would have sat at NO_DATA indefinitely while
 * every screen reported it as healthy and daily.
 *
 * This decides the DESIRED set of repeatable jobs from connection state. It is
 * pure: the caller applies the difference. That separation is what makes the
 * behaviour testable without a queue, and it is why reconciliation can run
 * repeatedly without drifting.
 *
 * Deliberately generic. There is no GoogleSearchConsoleCron here, because the
 * next provider would need its own, and then they would diverge. A connection
 * has a cadence; a cadence produces a schedule.
 */

/** Connection state the scheduler needs. Nothing provider-specific. */
export interface SchedulableConnection {
  id: string;
  providerId: string;
  status: string;
  syncFrequency: string | null;
  /** False when the provider is disabled or holds no usable credential. */
  hasActiveCredential: boolean;
}

export interface DesiredSchedule {
  /** Deterministic per connection, so two providers never collide. */
  jobId: string;
  connectionId: string;
  providerId: string;
  pattern: string;
  cadence: string;
}

export interface SchedulePlan {
  desired: DesiredSchedule[];
  /** jobIds present in the queue that must be removed. */
  obsolete: string[];
  /** jobIds whose cadence changed and must be replaced. */
  replace: DesiredSchedule[];
  reasons: string[];
}

/**
 * Statuses from which a scheduled sync may legitimately run. DISABLED and the
 * pre-credential states are excluded: a disabled connection that keeps syncing
 * is the failure operators least expect.
 */
const SCHEDULABLE_STATUSES = new Set([
  'READY', 'CONNECTED', 'SYNCING', 'HEALTHY', 'STALE', 'RATE_LIMITED',
]);

/**
 * Cadence -> cron. Times are deliberately off-peak and staggered from the
 * six-hourly Guardian so a daily collection and an evaluation do not contend.
 */
const CADENCE_PATTERNS: Record<string, string> = {
  HOURLY: '15 * * * *',
  DAILY: '20 3 * * *',
  WEEKLY: '20 3 * * 1',
  MONTHLY: '20 3 1 * *',
};

export const DEFAULT_CADENCE = 'DAILY';

export function jobIdFor(connectionId: string): string {
  // Job type + connection id. Provider name alone would collide the moment a
  // second connection to the same provider exists.
  return `seo-integration-sync:${connectionId}`;
}

export function patternFor(cadence: string | null): string | null {
  const key = String(cadence ?? '').trim().toUpperCase();
  if (key === '') return CADENCE_PATTERNS[DEFAULT_CADENCE];
  return CADENCE_PATTERNS[key] ?? null;
}

export function isSchedulable(c: SchedulableConnection): boolean {
  return SCHEDULABLE_STATUSES.has(String(c.status ?? '').toUpperCase()) && c.hasActiveCredential;
}

/**
 * Compare what should exist against what does.
 *
 * `existing` is the set of repeatable jobs currently registered, keyed by
 * jobId, with the pattern each was registered under. Anything belonging to
 * this family that is not desired is obsolete — that is how a deleted or
 * disabled connection stops syncing without anyone remembering to unregister
 * it.
 */
export function planSchedules(input: {
  connections: SchedulableConnection[];
  existing: Array<{ jobId: string; pattern: string }>;
}): SchedulePlan {
  const reasons: string[] = [];
  const desired: DesiredSchedule[] = [];

  for (const c of input.connections ?? []) {
    if (!isSchedulable(c)) {
      reasons.push(`${c.providerId}/${c.id}: not schedulable (status ${c.status}, credential ${c.hasActiveCredential ? 'active' : 'absent'}).`);
      continue;
    }
    const pattern = patternFor(c.syncFrequency);
    if (!pattern) {
      // An unrecognised cadence must not silently become a default — that
      // would invent a schedule nobody configured.
      reasons.push(`${c.providerId}/${c.id}: cadence "${c.syncFrequency}" is not a recognised frequency; no schedule created.`);
      continue;
    }
    desired.push({
      jobId: jobIdFor(c.id), connectionId: c.id, providerId: c.providerId,
      pattern, cadence: String(c.syncFrequency ?? DEFAULT_CADENCE).toUpperCase(),
    });
  }

  const desiredById = new Map(desired.map((d) => [d.jobId, d]));
  const existing = input.existing ?? [];
  const obsolete: string[] = [];
  const replace: DesiredSchedule[] = [];

  for (const e of existing) {
    // Only this family is ours to reconcile; other crons are untouched.
    if (!e.jobId.startsWith('seo-integration-sync:')) continue;
    const want = desiredById.get(e.jobId);
    if (!want) {
      obsolete.push(e.jobId);
      reasons.push(`${e.jobId}: no longer corresponds to a schedulable connection; removing.`);
      continue;
    }
    if (want.pattern !== e.pattern) {
      replace.push(want);
      reasons.push(`${e.jobId}: cadence changed (${e.pattern} -> ${want.pattern}); replacing.`);
    }
  }

  // Duplicates of the same jobId collapse to one by construction: the queue
  // keys repeats by jobId, so registering twice is a no-op rather than a
  // second schedule. That is what makes multi-replica boot safe.
  const duplicates = existing.filter((e) => e.jobId.startsWith('seo-integration-sync:'))
    .reduce((acc, e) => acc.set(e.jobId, (acc.get(e.jobId) ?? 0) + 1), new Map<string, number>());
  for (const [jobId, count] of duplicates) {
    if (count > 1) reasons.push(`${jobId}: ${count} registrations found where one is expected; the queue key collapses these.`);
  }

  return { desired, obsolete, replace, reasons };
}
