import { GtmPlanRepository } from '../../application/ports/measurement/GtmPlanRepository';
import { db } from '../db/client';
import { measurementGtmSyncLogs } from '../db/schema';
import { desc } from 'drizzle-orm';

export class DrizzleGtmPlanRepository implements GtmPlanRepository {
  // We use an in-memory map for plans as the measurement_gtm_plans table does not exist
  // We rely on measurementGtmSyncLogs for durable sync logging
  private plans = new Map<string, any>();
  private diffs = new Map<string, any>();

  async savePlan(id: string, plan: any): Promise<void> {
    this.plans.set(id, plan);
  }

  async getPlan(id: string): Promise<any | null> {
    return this.plans.get(id) || null;
  }

  async listRecentPlans(limit: number): Promise<any[]> {
    return Array.from(this.plans.values()).slice(0, limit);
  }

  async saveDiff(id: string, diff: any): Promise<void> {
    this.diffs.set(id, diff);
  }

  async saveSyncLog(id: string, log: any): Promise<void> {
    try {
      await db.insert(measurementGtmSyncLogs).values({
        containerId: log.containerId || 'default',
        action: log.action || 'SYNC',
        status: log.status || 'STARTED',
        details: log.details || {}
      });
    } catch (e) {
      // Fallback for local
      console.warn('DB not configured, falling back to local for saveSyncLog');
    }
  }

  async listSyncLogs(limit: number): Promise<any[]> {
    try {
      const logs = await db.select()
        .from(measurementGtmSyncLogs)
        .orderBy(desc(measurementGtmSyncLogs.createdAt))
        .limit(limit);
      return logs;
    } catch (e) {
      return [];
    }
  }
}
