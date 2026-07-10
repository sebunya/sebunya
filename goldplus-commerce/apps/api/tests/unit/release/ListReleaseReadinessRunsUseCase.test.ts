import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListReleaseReadinessRunsUseCase } from '../../../src/application/use-cases/release/ListReleaseReadinessRunsUseCase';
import { IReleaseReadinessRepository, ReleaseReadinessRun } from '../../../src/application/ports/release/ReleaseReadinessRepository';
import { IReleaseReadinessAccessPolicy } from '../../../src/application/ports/release/ReleaseReadinessAccessPolicy';

describe('ListReleaseReadinessRunsUseCase', () => {
  let useCase: ListReleaseReadinessRunsUseCase;
  let repository: import('vitest').Mocked<IReleaseReadinessRepository>;
  let accessPolicy: import('vitest').Mocked<IReleaseReadinessAccessPolicy>;

  beforeEach(() => {
    repository = {
      listReadinessRuns: vi.fn(),
    } as unknown as import('vitest').Mocked<IReleaseReadinessRepository>;

    accessPolicy = {
      canViewReleaseReadiness: vi.fn(),
    } as unknown as import('vitest').Mocked<IReleaseReadinessAccessPolicy>;

    useCase = new ListReleaseReadinessRunsUseCase(repository, accessPolicy);
  });

  it('throws unauthorized if user lacks permissions', async () => {
    accessPolicy.canViewReleaseReadiness.mockReturnValue(false);

    await expect(useCase.execute(50, 0, 'admin-1', []))
      .rejects.toThrow('Unauthorized to view release readiness runs');
  });

  it('returns list of runs successfully', async () => {
    accessPolicy.canViewReleaseReadiness.mockReturnValue(true);
    repository.listReadinessRuns.mockResolvedValue([
      { id: 'run-1', status: 'PASS' } as ReleaseReadinessRun
    ]);

    const result = await useCase.execute(10, 0, 'admin-1', []);

    expect(result.length).toBe(1);
    expect(result[0].id).toBe('run-1');
  });
});
