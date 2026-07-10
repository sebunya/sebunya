import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetReleaseReadinessSummaryUseCase } from '../../../src/application/use-cases/release/GetReleaseReadinessSummaryUseCase';
import { IReleaseReadinessRepository, ReleaseReadinessRun, ReleaseDecision } from '../../../src/application/ports/release/ReleaseReadinessRepository';
import { IReleaseReadinessAccessPolicy } from '../../../src/application/ports/release/ReleaseReadinessAccessPolicy';
import { IReleaseReadinessAuditRepository } from '../../../src/application/ports/release/ReleaseReadinessAuditRepository';

describe('GetReleaseReadinessSummaryUseCase', () => {
  let useCase: GetReleaseReadinessSummaryUseCase;
  let repository: import('vitest').Mocked<IReleaseReadinessRepository>;
  let accessPolicy: import('vitest').Mocked<IReleaseReadinessAccessPolicy>;
  let auditRepository: import('vitest').Mocked<IReleaseReadinessAuditRepository>;

  beforeEach(() => {
    repository = {
      getLatestReadinessRun: vi.fn(),
      getGateResultsForRun: vi.fn(),
      getReleaseDecisionSummary: vi.fn(),
    } as unknown as import('vitest').Mocked<IReleaseReadinessRepository>;

    accessPolicy = {
      canViewReleaseReadiness: vi.fn(),
    } as unknown as import('vitest').Mocked<IReleaseReadinessAccessPolicy>;

    auditRepository = {
      recordReadinessViewed: vi.fn(),
    } as unknown as import('vitest').Mocked<IReleaseReadinessAuditRepository>;

    useCase = new GetReleaseReadinessSummaryUseCase(repository, accessPolicy, auditRepository);
  });

  it('throws unauthorized if user lacks permissions', async () => {
    accessPolicy.canViewReleaseReadiness.mockReturnValue(false);

    await expect(useCase.execute('admin-1', []))
      .rejects.toThrow('Unauthorized to view release readiness');
  });

  it('returns nulls if no run exists', async () => {
    accessPolicy.canViewReleaseReadiness.mockReturnValue(true);
    repository.getLatestReadinessRun.mockResolvedValue(null);

    const summary = await useCase.execute('admin-1', ['RELEASE_READINESS_READ']);

    expect(summary.latestRun).toBeNull();
    expect(summary.gates).toEqual([]);
    expect(summary.decision).toBeNull();
    expect(auditRepository.recordReadinessViewed).toHaveBeenCalledWith('admin-1');
  });

  it('returns run, gates, and decision summary', async () => {
    accessPolicy.canViewReleaseReadiness.mockReturnValue(true);
    
    repository.getLatestReadinessRun.mockResolvedValue({ id: 'run-1', status: 'PASS' } as ReleaseReadinessRun);
    repository.getGateResultsForRun.mockResolvedValue([]);
    repository.getReleaseDecisionSummary.mockResolvedValue({ id: 'dec-1', status: 'APPROVED_FOR_CONTROLLED_ACTIVATION' } as ReleaseDecision);

    const summary = await useCase.execute('admin-1', ['RELEASE_READINESS_READ']);

    expect(summary.latestRun?.id).toBe('run-1');
    expect(summary.decision?.status).toBe('APPROVED_FOR_CONTROLLED_ACTIVATION');
  });
});
