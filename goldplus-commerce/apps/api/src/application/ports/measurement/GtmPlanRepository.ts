export interface GtmPlanRepository {
  savePlan(id: string, plan: any): Promise<void>;
  getPlan(id: string): Promise<any | null>;
  listRecentPlans(limit: number): Promise<any[]>;
  saveDiff(id: string, diff: any): Promise<void>;
  saveSyncLog(id: string, log: any): Promise<void>;
  listSyncLogs(limit: number): Promise<any[]>;
}
