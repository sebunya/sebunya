import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../logging/logger';
import { QueueService, QUEUES } from '../queues/QueueService';
import { Registry } from '../Registry';
import {
  planSchedules, jobIdFor,
  type SchedulableConnection,
} from '../../application/use-cases/seo-growth/IntegrationScheduleReconciler';

/**
 * Applies the schedule plan to the real queue, and executes a cadence tick.
 *
 * The planner decides; this only carries out the difference. Everything here
 * is idempotent, because it runs hourly on every replica.
 */

const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : (r as any)?.rows ?? []);

async function loadConnections(): Promise<SchedulableConnection[]> {
  const rows = rowsOf(await db.execute(sql`
    select n.id::text as id, n.provider_id, n.status, n.sync_frequency,
           exists (
             select 1 from seo_integration_credentials c
             where c.connection_id = n.id and c.status = 'ACTIVE'
           ) as has_active_credential
    from seo_integration_connections n
  `));
  return rows.map((r) => ({
    id: String(r.id),
    providerId: String(r.provider_id),
    status: String(r.status),
    syncFrequency: r.sync_frequency ? String(r.sync_frequency) : null,
    hasActiveCredential: Boolean(r.has_active_credential),
  }));
}

export async function reconcileIntegrationSchedules(): Promise<{
  desired: number; created: number; replaced: number; removed: number; unchanged: number; reasons: string[];
}> {
  const queue = QueueService.getInstance().getQueue(QUEUES.ANALYTICS_FANOUT);
  if (!queue) {
    logger.warn('[IntegrationSchedule] Queue unavailable; schedules unchanged.');
    return { desired: 0, created: 0, replaced: 0, removed: 0, unchanged: 0, reasons: ['Queue unavailable.'] };
  }

  const connections = await loadConnections();
  const repeatables = await queue.getRepeatableJobs();
  const existing = repeatables
    .filter((r: any) => String(r.name) === 'seo-integration-scheduled-sync')
    .map((r: any) => ({ jobId: String(r.id ?? ''), pattern: String(r.pattern ?? r.cron ?? ''), key: String(r.key ?? '') }));

  const plan = planSchedules({ connections, existing: existing.map(({ jobId, pattern }) => ({ jobId, pattern })) });

  let created = 0, replaced = 0, removed = 0, unchanged = 0;

  // Remove first, so a cadence replacement never leaves both patterns live.
  const removals = new Set([...plan.obsolete, ...plan.replace.map((d) => d.jobId)]);
  for (const e of existing) {
    if (!removals.has(e.jobId)) continue;
    try {
      await queue.removeRepeatableByKey(e.key);
      if (plan.obsolete.includes(e.jobId)) removed += 1; else replaced += 1;
    } catch (err) {
      logger.warn({ err: String((err as Error)?.message ?? err), jobId: e.jobId }, '[IntegrationSchedule] Failed to remove repeatable');
    }
  }

  for (const d of plan.desired) {
    const already = existing.find((e) => e.jobId === d.jobId && !removals.has(e.jobId));
    if (already) { unchanged += 1; continue; }
    await queue.add(
      'seo-integration-scheduled-sync',
      { connectionId: d.connectionId, providerId: d.providerId },
      // jobId is the deterministic identity: registering the same schedule from
      // every replica collapses to one, which is what makes boot safe.
      { repeat: { pattern: d.pattern }, jobId: d.jobId },
    );
    if (plan.replace.some((r) => r.jobId === d.jobId)) { /* counted as replaced above */ } else created += 1;
  }

  return { desired: plan.desired.length, created, replaced, removed, unchanged, reasons: plan.reasons };
}

/**
 * One cadence tick for a connection.
 *
 * Deliberately re-checks eligibility and in-flight state at execution time
 * rather than trusting the schedule: a connection disabled since the tick was
 * registered must not sync, and a restart after downtime must not stack
 * overlapping collections.
 */
export async function enqueueScheduledSync(connectionId: string): Promise<{
  enqueued: boolean; reason: string; jobId?: string;
}> {
  if (!connectionId) return { enqueued: false, reason: 'No connection id on the scheduled job.' };

  const repo = Registry.getInstance().seoIntegrationRepo;
  const connection = await repo.getConnection(connectionId);
  if (!connection) return { enqueued: false, reason: 'Connection no longer exists.' };

  const conns = await loadConnections();
  const state = conns.find((c) => c.id === connectionId);
  if (!state || !state.hasActiveCredential) {
    return { enqueued: false, reason: 'Connection holds no active credential.' };
  }
  if (String(connection.status).toUpperCase() === 'DISABLED') {
    return { enqueued: false, reason: 'Connection is disabled.' };
  }

  // Overlap guard: the same check the manual endpoint performs. A daily tick
  // arriving while yesterday's collection is still running must not start a
  // second one against the same connection.
  const running = await repo.listSyncJobs({ connectionId, status: 'RUNNING', limit: 1 });
  const queued = await repo.listSyncJobs({ connectionId, status: 'QUEUED', limit: 1 });
  if (running.length > 0 || queued.length > 0) {
    return { enqueued: false, reason: 'A sync job is already queued or running for this connection.' };
  }

  const queue = QueueService.getInstance().getQueue(QUEUES.ANALYTICS_FANOUT);
  if (!queue) return { enqueued: false, reason: 'Queue unavailable; no job created.' };

  // The SAME persisted job the manual path creates. Only the trigger differs.
  const job = await repo.createSyncJob({ connectionId, jobType: 'SCHEDULED', requestedBy: null });
  await queue.add('seo-integration-sync', { jobId: job.id, connectionId, providerId: connection.provider_id });

  return { enqueued: true, reason: 'Scheduled sync enqueued.', jobId: job.id };
}
