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
// PROVIDER_ERROR belongs here with STALE and RATE_LIMITED: it is what one
// failed call from the provider leaves behind, and it is transient. Excluded,
// a single timeout parked the connection in a state the scheduler would never
// pick up again, so the sync stopped for good with nothing to say so.
// NOT_CONFIGURED stays out: that one really does need a person.
const SCHEDULABLE_STATUSES = new Set([
  'READY', 'CONNECTED', 'SYNCING', 'HEALTHY', 'STALE', 'RATE_LIMITED', 'PROVIDER_ERROR',
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

/** Milliseconds a cadence must elapse before another collection is due. */
const CADENCE_INTERVAL_MS: Record<string, number> = {
  HOURLY: 60 * 60 * 1000,
  DAILY: 24 * 60 * 60 * 1000,
  WEEKLY: 7 * 24 * 60 * 60 * 1000,
  MONTHLY: 30 * 24 * 60 * 60 * 1000,
};

export interface DueDecision {
  connectionId: string;
  providerId: string;
  due: boolean;
  reason: string;
}

/**
 * Which connections are due for collection right now.
 *
 * Due-ness is derived from durable state — cadence versus the last successful
 * collection — rather than from a per-connection repeatable job. That choice
 * is deliberate: the queue does not return the jobId of a registered
 * repeatable, so per-connection schedules could be created but never reliably
 * found again to update or remove. A schedule that cannot be removed is worse
 * than no schedule: a disabled connection would keep syncing forever.
 *
 * Deriving from state also makes every §9 case fall out for free — disable,
 * delete, cadence change and re-enable are all just a different answer to the
 * same question, evaluated fresh each tick.
 */
export function decideDueConnections(input: {
  connections: SchedulableConnection[];
  /** Last successful collection per connection id, epoch ms. */
  lastSuccessMs: Map<string, number | null>;
  nowMs: number;
}): DueDecision[] {
  const out: DueDecision[] = [];
  for (const c of input.connections ?? []) {
    if (!isSchedulable(c)) {
      out.push({ connectionId: c.id, providerId: c.providerId, due: false,
        reason: `Not schedulable (status ${c.status}, credential ${c.hasActiveCredential ? 'active' : 'absent'}).` });
      continue;
    }
    const cadence = String(c.syncFrequency ?? DEFAULT_CADENCE).toUpperCase();
    const interval = CADENCE_INTERVAL_MS[cadence];
    if (!interval) {
      out.push({ connectionId: c.id, providerId: c.providerId, due: false,
        reason: `Cadence "${c.syncFrequency}" is not recognised; no collection scheduled.` });
      continue;
    }
    const last = input.lastSuccessMs.get(c.id) ?? null;
    if (last === null) {
      out.push({ connectionId: c.id, providerId: c.providerId, due: true,
        reason: 'Never collected successfully; first scheduled collection is due.' });
      continue;
    }
    const elapsed = input.nowMs - last;
    out.push({
      connectionId: c.id, providerId: c.providerId,
      due: elapsed >= interval,
      reason: elapsed >= interval
        ? `${cadence} cadence elapsed (${Math.floor(elapsed / 3_600_000)}h since last success).`
        : `Not due: ${Math.floor(elapsed / 3_600_000)}h of the ${cadence} interval elapsed.`,
    });
  }
  return out;
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
