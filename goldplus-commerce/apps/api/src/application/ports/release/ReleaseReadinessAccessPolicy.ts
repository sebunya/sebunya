export interface IReleaseReadinessAccessPolicy {
  canViewReleaseReadiness(adminUserId: string, permissions: string[]): boolean;
  canRunReleaseChecks(adminUserId: string, permissions: string[]): boolean;
  canRecordReleaseDecision(adminUserId: string, permissions: string[]): boolean;
  canAcknowledgeGate(adminUserId: string, permissions: string[]): boolean;
}
