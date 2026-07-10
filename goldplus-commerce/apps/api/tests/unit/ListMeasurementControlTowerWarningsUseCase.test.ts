import { describe, it, expect, vi } from 'vitest';
import { ListMeasurementControlTowerWarningsUseCase } from '../../src/application/use-cases/admin/ListMeasurementControlTowerWarningsUseCase';

describe('ListMeasurementControlTowerWarningsUseCase', () => {
  it('returns redacted warnings', async () => {
    const mockAccessPolicy = {
      canViewMeasurementDashboard: vi.fn().mockReturnValue(true),
      canViewDataQualityWarnings: vi.fn().mockReturnValue(true),
    };
    const mockRepo = {
      getDataQualityWarnings: vi.fn().mockResolvedValue([
        { id: '1', issue: 'rawEmail: test@test.com blocked' }
      ]),
    };
    const mockRedactor = {
      redactPayload: vi.fn().mockReturnValue({ id: '1', issue: '[REDACTED]' }),
    };
    
    const useCase = new ListMeasurementControlTowerWarningsUseCase(mockRepo as any, mockAccessPolicy as any, mockRedactor as any);
    const result = await useCase.execute('admin1', []);
    expect(result[0].issue).toBe('[REDACTED]');
  });
});
