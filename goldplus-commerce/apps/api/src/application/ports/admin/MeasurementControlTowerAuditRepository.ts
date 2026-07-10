export interface IMeasurementControlTowerAuditRepository {
  recordDashboardViewed(adminUserId: string): Promise<void>;
  recordDashboardSectionViewed(adminUserId: string, sectionKey: string): Promise<void>;
  recordAdminDiagnosticViewed(adminUserId: string, diagnosticId: string): Promise<void>;
}
