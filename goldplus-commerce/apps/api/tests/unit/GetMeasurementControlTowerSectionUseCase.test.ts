import { describe, it, expect, vi } from 'vitest';
import { GetMeasurementControlTowerSectionUseCase } from '../../src/application/use-cases/admin/GetMeasurementControlTowerSectionUseCase';

describe('GetMeasurementControlTowerSectionUseCase', () => {
  it('throws ACCESS_DENIED if lacking base dashboard access', async () => {
    const mockAccessPolicy = { canViewMeasurementDashboard: vi.fn().mockReturnValue(false) };
    const uc = new GetMeasurementControlTowerSectionUseCase({} as any, mockAccessPolicy as any);
    await expect(uc.execute('admin1', [], 'health')).rejects.toThrow('ACCESS_DENIED');
  });

  it('throws INVALID_SECTION for unknown section', async () => {
    const mockAccessPolicy = { canViewMeasurementDashboard: vi.fn().mockReturnValue(true) };
    const useCase = new GetMeasurementControlTowerSectionUseCase({} as any, mockAccessPolicy as any);
    await expect(useCase.execute('admin1', [], 'unknown')).rejects.toThrow('INVALID_SECTION');
  });

  it('throws ACCESS_DENIED for paymentReconciliation without orders permission', async () => {
    const mockAccessPolicy = {
      canViewMeasurementDashboard: vi.fn().mockReturnValue(true),
      canViewPaymentReconciliationSummary: vi.fn().mockReturnValue(false),
    };
    const uc = new GetMeasurementControlTowerSectionUseCase({} as any, mockAccessPolicy as any);
    await expect(uc.execute('admin1', [], 'paymentReconciliation')).rejects.toThrow('ACCESS_DENIED');
  });

  it('returns health summary for health section', async () => {
    const mockAccessPolicy = { canViewMeasurementDashboard: vi.fn().mockReturnValue(true) };
    const mockRepo = { getMeasurementHealthSummary: vi.fn().mockResolvedValue({ totalSafeEvents: 10 }) };
    const uc = new GetMeasurementControlTowerSectionUseCase(mockRepo as any, mockAccessPolicy as any);
    const res = await uc.execute('admin1', [], 'health');
    expect(res.totalSafeEvents).toBe(10);
  });
});
