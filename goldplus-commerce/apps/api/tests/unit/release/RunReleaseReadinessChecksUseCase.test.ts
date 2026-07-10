import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunReleaseReadinessChecksUseCase } from '../../../src/application/use-cases/release/RunReleaseReadinessChecksUseCase';
import { IReleaseReadinessRepository } from '../../../src/application/ports/release/ReleaseReadinessRepository';
import { IReleaseReadinessAccessPolicy } from '../../../src/application/ports/release/ReleaseReadinessAccessPolicy';
import { IReleaseReadinessAuditRepository } from '../../../src/application/ports/release/ReleaseReadinessAuditRepository';
import { IReleaseReadinessCheckRunner } from '../../../src/application/ports/release/ReleaseReadinessCheckRunner';

describe('RunReleaseReadinessChecksUseCase', () => {
  let useCase: RunReleaseReadinessChecksUseCase;
  let repository: import('vitest').Mocked<IReleaseReadinessRepository>;
  let accessPolicy: import('vitest').Mocked<IReleaseReadinessAccessPolicy>;
  let auditRepository: import('vitest').Mocked<IReleaseReadinessAuditRepository>;
  let checkRunner: import('vitest').Mocked<IReleaseReadinessCheckRunner>;

  beforeEach(() => {
    repository = {
      createReadinessRun: vi.fn(),
      updateReadinessRun: vi.fn(),
      saveGateResults: vi.fn(),
    } as unknown as import('vitest').Mocked<IReleaseReadinessRepository>;

    accessPolicy = {
      canRunReleaseChecks: vi.fn(),
    } as unknown as import('vitest').Mocked<IReleaseReadinessAccessPolicy>;

    auditRepository = {
      recordReadinessRunStarted: vi.fn(),
      recordReadinessRunCompleted: vi.fn(),
    } as unknown as import('vitest').Mocked<IReleaseReadinessAuditRepository>;

    checkRunner = {
      runCheck: vi.fn(),
    } as import('vitest').Mocked<IReleaseReadinessCheckRunner>;

    useCase = new RunReleaseReadinessChecksUseCase(repository, checkRunner, accessPolicy, auditRepository);
  });

  it('throws unauthorized if user lacks permissions', async () => {
    accessPolicy.canRunReleaseChecks.mockReturnValue(false);

    await expect(useCase.execute('admin-1', []))
      .rejects.toThrow('Unauthorized to run release checks');
  });

  it('starts a run and returns runId successfully', async () => {
    accessPolicy.canRunReleaseChecks.mockReturnValue(true);
    
    // We mock checkRunner.runCheck to delay slightly so the async background job continues later
    checkRunner.runCheck.mockResolvedValue({ id: 'g1', runId: '', gateId: 'CODE:TYPECHECK', category: 'CODE', name: 'Typecheck', status: 'PASS', severity: 'CRITICAL', evidence: {}, source: 'runner', checkedAt: '' });
    
    const runId = await useCase.execute('admin-1', ['RELEASE_READINESS_RUN']);
    
    expect(runId).toBeDefined();
    expect(repository.createReadinessRun).toHaveBeenCalledWith(runId, 'admin-1');
    expect(auditRepository.recordReadinessRunStarted).toHaveBeenCalledWith('admin-1', runId);
  });
});
