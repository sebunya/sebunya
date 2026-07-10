import { describe, it, expect, vi } from 'vitest';
import { RecordMeasurementControlTowerViewUseCase } from '../../src/application/use-cases/admin/RecordMeasurementControlTowerViewUseCase';

describe('RecordMeasurementControlTowerViewUseCase', () => {
  it('records safe audit log', async () => {
    const mockAccessPolicy = {
      canViewMeasurementDashboard: vi.fn().mockReturnValue(true),
    };
    const mockAuditRepo = {
      recordDashboardSectionViewed: vi.fn().mockResolvedValue(undefined),
    };
    
    const useCase = new RecordMeasurementControlTowerViewUseCase(mockAuditRepo as any, mockAccessPolicy as any);
    await useCase.execute('admin1', [], 'health');
    
    expect(mockAuditRepo.recordDashboardSectionViewed).toHaveBeenCalledWith('admin1', 'health');
  });
});
