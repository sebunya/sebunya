import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValidateGtmMeasurementPlanUseCase } from '../../apps/api/src/application/use-cases/measurement/ValidateGtmMeasurementPlanUseCase';
import { GtmPlanBuilder } from '../../apps/api/src/application/services/measurement/GtmPlanBuilder';
import { GtmDiffService } from '../../apps/api/src/application/services/measurement/GtmDiffService';

describe('ValidateGtmMeasurementPlanUseCase', () => {
  let useCase: ValidateGtmMeasurementPlanUseCase;
  let mockGtmRepo: any;

  beforeEach(() => {
    mockGtmRepo = {
      getCredentialStatus: vi.fn().mockResolvedValue({ configured: true, missingVariables: [] }),
      listWorkspaces: vi.fn().mockResolvedValue({ success: true, data: [{ path: 'mock-ws' }] }),
      listTags: vi.fn().mockResolvedValue({ success: true, data: [] })
    };
    useCase = new ValidateGtmMeasurementPlanUseCase(
      mockGtmRepo as any,
      new GtmPlanBuilder(),
      new GtmDiffService()
    );
  });

  it('fails if not configured', async () => {
    mockGtmRepo.getCredentialStatus.mockResolvedValue({ configured: false });
    const result = await useCase.execute('mock-container', 'web');
    expect(result.status).toBe('NOT_CONFIGURED');
  });

  it('validates a correct plan', async () => {
    const result = await useCase.execute('mock-container', 'web');
    expect(result.status).toBe('OK');
    expect(result.data).toBeDefined();
    expect(result.data.changes.length).toBeGreaterThan(0);
    expect(result.data.unsafePublishFound).toBe(false);
  });
});
