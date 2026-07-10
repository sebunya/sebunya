export interface IMeasurementControlTowerAccessPolicy {
  canViewMeasurementDashboard(adminUserId: string, permissions: string[]): boolean;
  canViewPaymentReconciliationSummary(adminUserId: string, permissions: string[]): boolean;
  canViewGtmStatus(adminUserId: string, permissions: string[]): boolean;
  canViewDataQualityWarnings(adminUserId: string, permissions: string[]): boolean;
}
