import { describe, it, expect, vi } from 'vitest';
import { GetMeasurementControlTowerSummaryUseCase } from '../../src/application/use-cases/admin/GetMeasurementControlTowerSummaryUseCase';

describe('GetMeasurementControlTowerSummaryUseCase', () => {
  it('returns DASHBOARD_READY and safe data when permissions are valid', async () => {
    const mockAccessPolicy = {
      canViewMeasurementDashboard: vi.fn().mockReturnValue(true),
      canViewPaymentReconciliationSummary: vi.fn().mockReturnValue(true),
      canViewGtmStatus: vi.fn().mockReturnValue(true),
      canViewDataQualityWarnings: vi.fn().mockReturnValue(true),
      canViewGtmConfig: vi.fn(),
      canViewRawAuditLogs: vi.fn(),
    };
    const mockRepo = {
      getMeasurementHealthSummary: vi.fn().mockResolvedValue({ totalSafeEvents: 100 }),
      getConsentSafetySummary: vi.fn().mockResolvedValue({ advertisingConsentGranted: 50 }),
      getProductFinderSummary: vi.fn().mockResolvedValue({ finderSessionsStarted: 20 }),
      getPreferenceCentreSummary: vi.fn().mockResolvedValue({ preferencesUpdated: 10 }),
      getPaymentReconciliationSummary: vi.fn().mockResolvedValue({ verifiedPurchaseConversions: 5 }),
      getPaidSocialReadinessSummary: vi.fn().mockResolvedValue({ eventsEligibleForRouting: 15 }),
      getGtmAutomationSummary: vi.fn().mockResolvedValue({ gtmCredentialsStatus: 'CONFIGURED' }),
      getDataQualityWarnings: vi.fn().mockResolvedValue([{ id: '1', severity: 'HIGH' }]),
      getAdminReviewQueue: vi.fn(),
      getRecentRedactedEvents: vi.fn(),
    };
    
    const useCase = new GetMeasurementControlTowerSummaryUseCase(mockRepo as any, mockAccessPolicy as any);
    const result = await useCase.execute('admin1', ['reports.read', 'orders.read']);
    
    expect(result.status).toBe('DASHBOARD_READY');
    expect(result.health.totalSafeEvents).toBe(100);
    expect(result.consent.advertisingConsentGranted).toBe(50);
    expect(result.productFinder.finderSessionsStarted).toBe(20);
    expect(result.preferenceCentre.preferencesUpdated).toBe(10);
    expect(result.paymentReconciliation?.verifiedPurchaseConversions).toBe(5);
    expect(result.paidSocialReadiness.eventsEligibleForRouting).toBe(15);
    expect(result.gtmAutomation?.gtmCredentialsStatus).toBe('CONFIGURED');
    expect(result.warnings?.length).toBe(1);
  });

  it('throws ACCESS_DENIED if missing dashboard permissions', async () => {
    const mockAccessPolicy = {
      canViewMeasurementDashboard: vi.fn().mockReturnValue(false),
    };
    const useCase = new GetMeasurementControlTowerSummaryUseCase({} as any, mockAccessPolicy as any);
    
    await expect(useCase.execute('admin1', [])).rejects.toThrow('ACCESS_DENIED');
  });
});
