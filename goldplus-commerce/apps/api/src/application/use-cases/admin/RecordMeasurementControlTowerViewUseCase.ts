import { IMeasurementControlTowerAuditRepository } from '../../ports/admin/MeasurementControlTowerAuditRepository';
import { IMeasurementControlTowerAccessPolicy } from '../../ports/admin/MeasurementControlTowerAccessPolicy';

export class RecordMeasurementControlTowerViewUseCase {
  constructor(
    private readonly auditRepository: IMeasurementControlTowerAuditRepository,
    private readonly accessPolicy: IMeasurementControlTowerAccessPolicy
  ) {}

  async execute(adminUserId: string, permissions: string[], sectionKey?: string): Promise<void> {
    if (!this.accessPolicy.canViewMeasurementDashboard(adminUserId, permissions)) {
      throw new Error('ACCESS_DENIED');
    }

    if (sectionKey) {
      await this.auditRepository.recordDashboardSectionViewed(adminUserId, sectionKey);
    } else {
      await this.auditRepository.recordDashboardViewed(adminUserId);
    }
  }
}
