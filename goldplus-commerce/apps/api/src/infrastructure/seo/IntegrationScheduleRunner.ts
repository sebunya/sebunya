import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../logging/logger';
import { QueueService, QUEUES } from '../queues/QueueService';
import { Registry } from '../Registry';
import {
  decideDueConnections,
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
  evaluated: number; due: number; enqueued: number; skipped: number; removedLegacy: number; reasons: string[];
}> {
  const queue = QueueService.getInstance().getQueue(QUEUES.ANALYTICS_FANOUT);
  if (!queue) {
    logger.warn('[IntegrationSchedule] Queue unavailable; no collection scheduled.');
    return { evaluated: 0, due: 0, enqueued: 0, skipped: 0, removedLegacy: 0, reasons: ['Queue unavailable.'] };
  }

  // Retire any per-connection repeatable left by the earlier design. The queue
  // does not return a repeatable's jobId, so those could be created but never
  // reliably found again — which would leave a disabled connection syncing
  // forever. Collection is now decided from state on each tick instead.
  let removedLegacy = 0;
  for (const r of (await queue.getRepeatableJobs()) as any[]) {
    if (String(r.name) !== 'seo-integration-scheduled-sync') continue;
    try { await queue.removeRepeatableByKey(String(r.key)); removedLegacy += 1; } catch { /* already gone */ }
  }

  const connections = await loadConnections();
  const lastSuccessMs = new Map<string, number | null>();
  for (const r of rowsOf(await db.execute(sql`
    select id::text as id, last_success_at from seo_integration_connections
  `))) {
    lastSuccessMs.set(String(r.id), r.last_success_at ? new Date(r.last_success_at as any).getTime() : null);
  }

  const decisions = decideDueConnections({ connections, lastSuccessMs, nowMs: Date.now() });
  const reasons: string[] = [];
  let enqueued = 0, skipped = 0;

  for (const d of decisions) {
    if (!d.due) { skipped += 1; reasons.push(`${d.providerId}/${d.connectionId}: ${d.reason}`); continue; }
    const res = await enqueueScheduledSync(d.connectionId);
    if (res.enqueued) enqueued += 1; else skipped += 1;
    reasons.push(`${d.providerId}/${d.connectionId}: ${d.reason} ${res.reason}`);
  }

  return {
    evaluated: decisions.length,
    due: decisions.filter((d) => d.due).length,
    enqueued, skipped, removedLegacy, reasons,
  };
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
