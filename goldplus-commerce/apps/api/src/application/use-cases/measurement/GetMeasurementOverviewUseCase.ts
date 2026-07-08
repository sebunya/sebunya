import type { MeasurementAdminRepository } from '../../ports/measurement/MeasurementAdminRepository';
import type { DlqRepository } from '../../ports/measurement/DlqRepository';
import type { AttributionRepository } from '../../ports/measurement/AttributionRepository';

export class GetMeasurementOverviewUseCase {
  constructor(
    private readonly adminRepo: MeasurementAdminRepository,
    private readonly dlqRepo: DlqRepository,
    private readonly attributionRepo: AttributionRepository
  ) {}

  async execute() {
    const [matchQuality, unresolvedDlqCount, consentBreakdown, pendingOutboxCount] = await Promise.all([
      this.attributionRepo.getMatchQualitySummary(7),
      this.dlqRepo.getUnresolvedCount(),
      this.adminRepo.getConsentBreakdown(),
      this.adminRepo.getPendingOutboxCount()
    ]);

    const totalConsent = consentBreakdown.length;
    const analyticsGranted = consentBreakdown.filter(r => r.analyticsGranted).length;
    const advertisingGranted = consentBreakdown.filter(r => r.advertisingGranted).length;
    const personalizationGranted = consentBreakdown.filter(r => r.personalizationGranted).length;

    return {
      matchQuality,
      dlq: {
        unresolvedCount: unresolvedDlqCount,
      },
      consent: {
        totalIdentities: totalConsent,
        analyticsGrantedPct: totalConsent > 0 ? Math.round((analyticsGranted / totalConsent) * 100) : 0,
        advertisingGrantedPct: totalConsent > 0 ? Math.round((advertisingGranted / totalConsent) * 100) : 0,
        personalizationGrantedPct: totalConsent > 0 ? Math.round((personalizationGranted / totalConsent) * 100) : 0,
      },
      outbox: {
        pendingTelemetryEvents: pendingOutboxCount,
      },
    };
  }
}
