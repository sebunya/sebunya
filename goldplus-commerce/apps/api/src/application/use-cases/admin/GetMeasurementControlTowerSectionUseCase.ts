import { IMeasurementControlTowerRepository } from '../../ports/admin/MeasurementControlTowerRepository';
import { IMeasurementControlTowerAccessPolicy } from '../../ports/admin/MeasurementControlTowerAccessPolicy';

export class GetMeasurementControlTowerSectionUseCase {
  constructor(
    private readonly repository: IMeasurementControlTowerRepository,
    private readonly accessPolicy: IMeasurementControlTowerAccessPolicy
  ) {}

  async execute(adminUserId: string, permissions: string[], sectionKey: string): Promise<any> {
    if (!this.accessPolicy.canViewMeasurementDashboard(adminUserId, permissions)) {
      throw new Error('ACCESS_DENIED');
    }

    switch (sectionKey) {
      case 'health':
        return await this.repository.getMeasurementHealthSummary();
      case 'consent':
        return await this.repository.getConsentSafetySummary();
      case 'productFinder':
        return await this.repository.getProductFinderSummary();
      case 'preferenceCentre':
        return await this.repository.getPreferenceCentreSummary();
      case 'paidSocialReadiness':
        return await this.repository.getPaidSocialReadinessSummary();
      case 'paymentReconciliation':
        if (!this.accessPolicy.canViewPaymentReconciliationSummary(adminUserId, permissions)) {
          throw new Error('ACCESS_DENIED');
        }
        return await this.repository.getPaymentReconciliationSummary();
      case 'gtmAutomation':
        if (!this.accessPolicy.canViewGtmStatus(adminUserId, permissions)) {
          throw new Error('ACCESS_DENIED');
        }
        return await this.repository.getGtmAutomationSummary();
      default:
        throw new Error('INVALID_SECTION');
    }
  }
}

