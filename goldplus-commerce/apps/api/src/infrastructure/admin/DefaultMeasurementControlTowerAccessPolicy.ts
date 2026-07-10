import { IMeasurementControlTowerAccessPolicy } from '../../application/ports/admin/MeasurementControlTowerAccessPolicy';
import { PERMISSIONS } from '@goldplus/shared';

export class DefaultMeasurementControlTowerAccessPolicy implements IMeasurementControlTowerAccessPolicy {
  canViewMeasurementDashboard(adminUserId: string, permissions: string[]): boolean {
    return permissions.includes(PERMISSIONS.REPORTS_READ);
  }

  canViewPaymentReconciliationSummary(adminUserId: string, permissions: string[]): boolean {
    return permissions.includes(PERMISSIONS.REPORTS_READ) || permissions.includes(PERMISSIONS.ORDERS_READ as string);
  }

  canViewGtmStatus(adminUserId: string, permissions: string[]): boolean {
    return permissions.includes(PERMISSIONS.REPORTS_READ);
  }

  canViewGtmConfig(adminUserId: string, permissions: string[]): boolean {
    return permissions.includes(PERMISSIONS.REPORTS_READ);
  }

  canViewRawAuditLogs(adminUserId: string, permissions: string[]): boolean {
    return permissions.includes(PERMISSIONS.REPORTS_READ);
  }

  canViewDataQualityWarnings(adminUserId: string, permissions: string[]): boolean {
    return permissions.includes(PERMISSIONS.REPORTS_READ);
  }
}
