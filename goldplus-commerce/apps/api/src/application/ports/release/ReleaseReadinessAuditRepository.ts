export interface IReleaseReadinessAuditRepository {
  recordReadinessViewed(adminUserId: string): Promise<void>;
  recordReadinessRunStarted(adminUserId: string, runId: string): Promise<void>;
  recordReadinessRunCompleted(adminUserId: string, runId: string, status: string): Promise<void>;
  recordReleaseDecisionRecorded(adminUserId: string, runId: string, decisionStatus: string): Promise<void>;
  recordGateAcknowledged(adminUserId: string, gateId: string, runId: string): Promise<void>;
}
