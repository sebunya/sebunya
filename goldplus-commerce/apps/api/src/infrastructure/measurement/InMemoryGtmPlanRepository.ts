import { GtmPlanRepository } from '../../application/ports/measurement/GtmPlanRepository';

export class InMemoryGtmPlanRepository implements GtmPlanRepository {
  private plans = new Map<string, any>();
  private diffs = new Map<string, any>();
  private syncLogs = new Map<string, any>();

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
    this.syncLogs.set(id, log);
  }

  async listSyncLogs(limit: number): Promise<any[]> {
    return Array.from(this.syncLogs.values()).slice(0, limit);
  }
}
