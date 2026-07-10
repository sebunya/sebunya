import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetReleaseReadinessRunUseCase } from '../../../src/application/use-cases/release/GetReleaseReadinessRunUseCase';
import { IReleaseReadinessRepository, ReleaseReadinessRun } from '../../../src/application/ports/release/ReleaseReadinessRepository';
import { IReleaseReadinessAccessPolicy } from '../../../src/application/ports/release/ReleaseReadinessAccessPolicy';

describe('GetReleaseReadinessRunUseCase', () => {
  let useCase: GetReleaseReadinessRunUseCase;
  let repository: import('vitest').Mocked<IReleaseReadinessRepository>;
  let accessPolicy: import('vitest').Mocked<IReleaseReadinessAccessPolicy>;

  beforeEach(() => {
    repository = {
      getReadinessRunById: vi.fn(),
      getGateResultsForRun: vi.fn(),
    } as unknown as import('vitest').Mocked<IReleaseReadinessRepository>;

    accessPolicy = {
      canViewReleaseReadiness: vi.fn(),
    } as unknown as import('vitest').Mocked<IReleaseReadinessAccessPolicy>;

    useCase = new GetReleaseReadinessRunUseCase(repository, accessPolicy);
  });

  it('throws unauthorized if user lacks permissions', async () => {
    accessPolicy.canViewReleaseReadiness.mockReturnValue(false);

    await expect(useCase.execute('run-1', 'admin-1', []))
      .rejects.toThrow('Unauthorized to view release readiness run');
  });

  it('throws not found if run does not exist', async () => {
    accessPolicy.canViewReleaseReadiness.mockReturnValue(true);
    repository.getReadinessRunById.mockResolvedValue(null);

    await expect(useCase.execute('run-1', 'admin-1', []))
      .rejects.toThrow('Run not found');
  });

  it('returns run and gates successfully', async () => {
    accessPolicy.canViewReleaseReadiness.mockReturnValue(true);
    repository.getReadinessRunById.mockResolvedValue({ id: 'run-1', status: 'PASS' } as ReleaseReadinessRun);
    repository.getGateResultsForRun.mockResolvedValue([]);

    const result = await useCase.execute('run-1', 'admin-1', []);

    expect(result.run.id).toBe('run-1');
    expect(result.gates).toEqual([]);
  });
});
