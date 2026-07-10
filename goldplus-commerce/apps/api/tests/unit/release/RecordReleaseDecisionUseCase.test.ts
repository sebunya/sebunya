import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecordReleaseDecisionUseCase } from '../../../src/application/use-cases/release/RecordReleaseDecisionUseCase';
import { IReleaseReadinessRepository, ReleaseReadinessRun, ReleaseReadinessGateResult, ReleaseDecision } from '../../../src/application/ports/release/ReleaseReadinessRepository';
import { IReleaseReadinessAccessPolicy } from '../../../src/application/ports/release/ReleaseReadinessAccessPolicy';
import { IReleaseReadinessAuditRepository } from '../../../src/application/ports/release/ReleaseReadinessAuditRepository';

describe('RecordReleaseDecisionUseCase', () => {
  let useCase: RecordReleaseDecisionUseCase;
  let repository: import('vitest').Mocked<IReleaseReadinessRepository>;
  let accessPolicy: import('vitest').Mocked<IReleaseReadinessAccessPolicy>;
  let auditRepository: import('vitest').Mocked<IReleaseReadinessAuditRepository>;

  beforeEach(() => {
    repository = {
      createReadinessRun: vi.fn(),
      updateReadinessRun: vi.fn(),
      saveGateResults: vi.fn(),
      getLatestReadinessRun: vi.fn(),
      getReadinessRunById: vi.fn(),
      listReadinessRuns: vi.fn(),
      getGateResultsForRun: vi.fn(),
      getReleaseDecisionSummary: vi.fn(),
      recordReleaseDecision: vi.fn(),
      acknowledgeGate: vi.fn(),
    } as unknown as import('vitest').Mocked<IReleaseReadinessRepository>;

    accessPolicy = {
      canViewReleaseReadiness: vi.fn(),
      canRunReleaseChecks: vi.fn(),
      canRecordReleaseDecision: vi.fn(),
      canAcknowledgeGate: vi.fn(),
    } as import('vitest').Mocked<IReleaseReadinessAccessPolicy>;

    auditRepository = {
      recordReadinessViewed: vi.fn(),
      recordReadinessRunStarted: vi.fn(),
      recordReadinessRunCompleted: vi.fn(),
      recordReleaseDecisionRecorded: vi.fn(),
      recordGateAcknowledged: vi.fn(),
    } as import('vitest').Mocked<IReleaseReadinessAuditRepository>;

    useCase = new RecordReleaseDecisionUseCase(repository, accessPolicy, auditRepository);
  });

  it('throws an error if user lacks permissions', async () => {
    accessPolicy.canRecordReleaseDecision.mockReturnValue(false);

    await expect(useCase.execute('run-1', 'APPROVED_FOR_CONTROLLED_ACTIVATION', undefined, 'user-1', []))
      .rejects.toThrow('Unauthorized to record release decision');
  });

  it('throws an error if run is not found', async () => {
    accessPolicy.canRecordReleaseDecision.mockReturnValue(true);
    repository.getReadinessRunById.mockResolvedValue(null);

    await expect(useCase.execute('run-1', 'APPROVED_FOR_CONTROLLED_ACTIVATION', undefined, 'user-1', []))
      .rejects.toThrow('Run not found');
  });

  it('throws an error if approving with unacknowledged critical failures', async () => {
    accessPolicy.canRecordReleaseDecision.mockReturnValue(true);
    repository.getReadinessRunById.mockResolvedValue({ id: 'run-1', status: 'FAIL', startedAt: '', triggeredBy: '' } as ReleaseReadinessRun);
    
    repository.getGateResultsForRun.mockResolvedValue([
      { id: 'g-1', status: 'FAIL', severity: 'CRITICAL' } as ReleaseReadinessGateResult
    ]);

    await expect(useCase.execute('run-1', 'APPROVED_FOR_CONTROLLED_ACTIVATION', undefined, 'user-1', []))
      .rejects.toThrow('Cannot approve release with unacknowledged critical failures');
  });

  it('records decision successfully when no unacknowledged critical failures exist', async () => {
    accessPolicy.canRecordReleaseDecision.mockReturnValue(true);
    repository.getReadinessRunById.mockResolvedValue({ id: 'run-1', status: 'WARN', startedAt: '', triggeredBy: '' } as ReleaseReadinessRun);
    
    repository.getGateResultsForRun.mockResolvedValue([
      { id: 'g-1', status: 'FAIL', severity: 'CRITICAL', acknowledgedAt: 'some-date' } as ReleaseReadinessGateResult
    ]);

    const mockDecision: ReleaseDecision = { id: 'd-1', runId: 'run-1', status: 'APPROVED_FOR_CONTROLLED_ACTIVATION', recordedBy: 'user-1', createdAt: '' };
    repository.recordReleaseDecision.mockResolvedValue(mockDecision);

    const result = await useCase.execute('run-1', 'APPROVED_FOR_CONTROLLED_ACTIVATION', undefined, 'user-1', []);

    expect(result).toBe(mockDecision);
    expect(auditRepository.recordReleaseDecisionRecorded).toHaveBeenCalledWith('user-1', 'run-1', 'APPROVED_FOR_CONTROLLED_ACTIVATION');
  });
});
