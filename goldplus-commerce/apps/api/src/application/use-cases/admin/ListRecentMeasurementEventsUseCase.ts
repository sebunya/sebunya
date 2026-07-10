import { IMeasurementControlTowerRepository, RecentRedactedEvent } from '../../ports/admin/MeasurementControlTowerRepository';
import { IMeasurementControlTowerAccessPolicy } from '../../ports/admin/MeasurementControlTowerAccessPolicy';
import { IMeasurementControlTowerRedactor } from '../../ports/admin/MeasurementControlTowerRedactor';

export class ListRecentMeasurementEventsUseCase {
  constructor(
    private readonly repository: IMeasurementControlTowerRepository,
    private readonly accessPolicy: IMeasurementControlTowerAccessPolicy,
    private readonly redactor: IMeasurementControlTowerRedactor
  ) {}

  async execute(adminUserId: string, permissions: string[], limit: number = 50, filters?: any): Promise<RecentRedactedEvent[]> {
    if (!this.accessPolicy.canViewMeasurementDashboard(adminUserId, permissions)) {
      throw new Error('ACCESS_DENIED');
    }

    const events = await this.repository.getRecentRedactedEvents(limit, filters);
    
    // Final redaction safety net
    return events.map(e => ({
      ...e,
      redactedPayload: this.redactor.redactPayload(e.redactedPayload),
    }));
  }
}
