import { IMeasurementControlTowerRepository, MeasurementControlTowerSummary } from '../../ports/admin/MeasurementControlTowerRepository';
import { IMeasurementControlTowerAccessPolicy } from '../../ports/admin/MeasurementControlTowerAccessPolicy';

export class GetMeasurementControlTowerSummaryUseCase {
  constructor(
    private readonly repository: IMeasurementControlTowerRepository,
    private readonly accessPolicy: IMeasurementControlTowerAccessPolicy
  ) {}

  async execute(adminUserId: string, permissions: string[]): Promise<MeasurementControlTowerSummary> {
    if (!this.accessPolicy.canViewMeasurementDashboard(adminUserId, permissions)) {
      throw new Error('ACCESS_DENIED');
    }

    const health = await this.repository.getMeasurementHealthSummary();
    const consent = await this.repository.getConsentSafetySummary();
    const productFinder = await this.repository.getProductFinderSummary();
    const preferenceCentre = await this.repository.getPreferenceCentreSummary();
    const paidSocialReadiness = await this.repository.getPaidSocialReadinessSummary();

    let paymentReconciliation;
    if (this.accessPolicy.canViewPaymentReconciliationSummary(adminUserId, permissions)) {
      paymentReconciliation = await this.repository.getPaymentReconciliationSummary();
    }

    let gtmAutomation;
    if (this.accessPolicy.canViewGtmStatus(adminUserId, permissions)) {
      gtmAutomation = await this.repository.getGtmAutomationSummary();
    }

    let warnings;
    if (this.accessPolicy.canViewDataQualityWarnings(adminUserId, permissions)) {
      warnings = await this.repository.getDataQualityWarnings(5);
    }

    return {
      status: 'DASHBOARD_READY',
      health,
      consent,
      productFinder,
      preferenceCentre,
      paymentReconciliation,
      paidSocialReadiness,
      gtmAutomation,
      warnings,
    };
  }
}

