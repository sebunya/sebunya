import { IMeasurementControlTowerAuditRepository } from '../../application/ports/admin/MeasurementControlTowerAuditRepository';
import { db } from '../db/client';
import { measurementControlTowerAuditLog } from '../db/schema/measurement_control_tower';

export class DrizzleMeasurementControlTowerAuditRepository implements IMeasurementControlTowerAuditRepository {
  async recordDashboardViewed(adminUserId: string): Promise<void> {
    await db.insert(measurementControlTowerAuditLog).values({
      adminUserId,
      action: 'VIEW_DASHBOARD',
    });
  }

  async recordDashboardSectionViewed(adminUserId: string, sectionKey: string): Promise<void> {
    await db.insert(measurementControlTowerAuditLog).values({
      adminUserId,
      action: 'VIEW_SECTION',
      section: sectionKey,
    });
  }

  async recordAdminDiagnosticViewed(adminUserId: string, diagnosticId: string): Promise<void> {
    await db.insert(measurementControlTowerAuditLog).values({
      adminUserId,
      action: 'VIEW_DIAGNOSTIC',
      safeReferenceId: diagnosticId,
    });
  }
}
