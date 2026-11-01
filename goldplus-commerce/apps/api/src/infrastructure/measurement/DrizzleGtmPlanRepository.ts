import { createHash } from 'node:crypto';
import { logger } from '../logging/logger';
import { GtmPlanRepository } from '../../application/ports/measurement/GtmPlanRepository';
import { db } from '../db/client';
import { measurementGtmSyncLogs, measurementGtmPlans } from '../db/schema';
import { desc, eq, sql } from 'drizzle-orm';

/**
 * Durable GTM plan repository (post-PR §3). Plans and diffs are persisted in
 * PostgreSQL (`measurement_gtm_plans`) rather than a process-local Map, so a
 * planned (dry-run) GTM change survives a restart and is consistent across
 * instances. Sync logs were already durable. GTM publication stays disabled.
 */
export class DrizzleGtmPlanRepository implements GtmPlanRepository {
  private checksum(plan: unknown): string {
    return createHash('sha256').update(JSON.stringify(plan ?? null)).digest('hex');
  }

  async savePlan(id: string, plan: any): Promise<void> {
    await db
      .insert(measurementGtmPlans)
      .values({ id, plan, planChecksum: this.checksum(plan) })
      .onConflictDoUpdate({
        target: measurementGtmPlans.id,
        // Optimistic version bump on overwrite; audit history stays via the row's
        // updated_at and the append-only sync logs.
        set: {
          plan,
          planChecksum: this.checksum(plan),
          version: sql`${measurementGtmPlans.version} + 1`,
          updatedAt: new Date(),
        },
      });
  }

  async getPlan(id: string): Promise<any | null> {
    const row = await db.query.measurementGtmPlans.findFirst({
      where: eq(measurementGtmPlans.id, id),
    });
    return row?.plan ?? null;
  }

  async listRecentPlans(limit: number): Promise<any[]> {
    const rows = await db
      .select({ plan: measurementGtmPlans.plan })
      .from(measurementGtmPlans)
      .orderBy(desc(measurementGtmPlans.createdAt))
      .limit(Math.max(1, Math.min(limit, 200)));
    return rows.map((r) => r.plan).filter((p) => p != null);
  }

  async saveDiff(id: string, diff: any): Promise<void> {
    // A diff belongs to a plan id; upsert so a diff can be recorded even before
    // the plan row exists.
    await db
      .insert(measurementGtmPlans)
      .values({ id, diff })
      .onConflictDoUpdate({
        target: measurementGtmPlans.id,
        set: { diff, updatedAt: new Date() },
      });
  }

  async saveSyncLog(id: string, log: any): Promise<void> {
    try {
      await db.insert(measurementGtmSyncLogs).values({
        containerId: log.containerId || 'default',
        action: log.action || 'SYNC',
        status: log.status || 'STARTED',
        details: log.details || {},
      });
    } catch (err) {
      // Sync logs are non-critical telemetry; never fail the caller, but record
      // the loss loudly rather than pretending a local fallback exists.
      logger.warn({ err: (err as Error)?.message }, '[GtmPlan] Failed to persist sync log');
    }
  }

  async listSyncLogs(limit: number): Promise<any[]> {
    const logs = await db
      .select()
      .from(measurementGtmSyncLogs)
      .orderBy(desc(measurementGtmSyncLogs.createdAt))
      .limit(Math.max(1, Math.min(limit, 200)));
    return logs;
  }
}
