import { IMeasurementControlTowerRepository, DataQualityWarning } from '../../ports/admin/MeasurementControlTowerRepository';
import { IMeasurementControlTowerAccessPolicy } from '../../ports/admin/MeasurementControlTowerAccessPolicy';
import { IMeasurementControlTowerRedactor } from '../../ports/admin/MeasurementControlTowerRedactor';

export class ListMeasurementControlTowerWarningsUseCase {
  constructor(
    private readonly repository: IMeasurementControlTowerRepository,
    private readonly accessPolicy: IMeasurementControlTowerAccessPolicy,
    private readonly redactor: IMeasurementControlTowerRedactor
  ) {}

  async execute(adminUserId: string, permissions: string[], limit: number = 50): Promise<DataQualityWarning[]> {
    if (!this.accessPolicy.canViewMeasurementDashboard(adminUserId, permissions)) {
      throw new Error('ACCESS_DENIED');
    }
    if (!this.accessPolicy.canViewDataQualityWarnings(adminUserId, permissions)) {
      throw new Error('ACCESS_DENIED');
    }

    const warnings = await this.repository.getDataQualityWarnings(limit);
    
    // Ensure all warning issues are redacted if they somehow contain PII
    return warnings.map(w => ({
      ...w,
      issue: this.redactor.redactPayload({ issue: w.issue }).issue,
    }));
  }
}
