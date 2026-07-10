import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcknowledgeReleaseGateUseCase } from '../../../src/application/use-cases/release/AcknowledgeReleaseGateUseCase';
import { IReleaseReadinessRepository, ReleaseReadinessRun, ReleaseReadinessGateResult } from '../../../src/application/ports/release/ReleaseReadinessRepository';
import { IReleaseReadinessAccessPolicy } from '../../../src/application/ports/release/ReleaseReadinessAccessPolicy';
import { IReleaseReadinessAuditRepository } from '../../../src/application/ports/release/ReleaseReadinessAuditRepository';

describe('AcknowledgeReleaseGateUseCase', () => {
  let useCase: AcknowledgeReleaseGateUseCase;
  let repository: import('vitest').Mocked<IReleaseReadinessRepository>;
  let accessPolicy: import('vitest').Mocked<IReleaseReadinessAccessPolicy>;
  let auditRepository: import('vitest').Mocked<IReleaseReadinessAuditRepository>;

  beforeEach(() => {
    repository = {
      getReadinessRunById: vi.fn(),
      getGateResultsForRun: vi.fn(),
      acknowledgeGate: vi.fn(),
    } as unknown as import('vitest').Mocked<IReleaseReadinessRepository>;

    accessPolicy = {
      canAcknowledgeGate: vi.fn(),
    } as unknown as import('vitest').Mocked<IReleaseReadinessAccessPolicy>;

    auditRepository = {
      recordGateAcknowledged: vi.fn(),
    } as unknown as import('vitest').Mocked<IReleaseReadinessAuditRepository>;

    useCase = new AcknowledgeReleaseGateUseCase(repository, accessPolicy, auditRepository);
  });

  it('throws unauthorized if user lacks permissions', async () => {
    accessPolicy.canAcknowledgeGate.mockReturnValue(false);

    await expect(useCase.execute('gate-1', 'run-1', 'reason', 'admin-1', []))
      .rejects.toThrow('Unauthorized to acknowledge release gates');
  });

  it('throws error if reason is missing', async () => {
    accessPolicy.canAcknowledgeGate.mockReturnValue(true);

    await expect(useCase.execute('gate-1', 'run-1', '', 'admin-1', []))
      .rejects.toThrow('Acknowledgement reason is required');
  });

  it('throws error if run not found', async () => {
    accessPolicy.canAcknowledgeGate.mockReturnValue(true);
    repository.getReadinessRunById.mockResolvedValue(null);

    await expect(useCase.execute('gate-1', 'run-1', 'reason', 'admin-1', []))
      .rejects.toThrow('Run not found');
  });

  it('throws error if gate not found', async () => {
    accessPolicy.canAcknowledgeGate.mockReturnValue(true);
    repository.getReadinessRunById.mockResolvedValue({ id: 'run-1' } as ReleaseReadinessRun);
    repository.getGateResultsForRun.mockResolvedValue([]);

    await expect(useCase.execute('gate-1', 'run-1', 'reason', 'admin-1', []))
      .rejects.toThrow('Gate result not found');
  });

  it('acknowledges gate successfully and preserves FAIL status (does not convert to PASS)', async () => {
    accessPolicy.canAcknowledgeGate.mockReturnValue(true);
    repository.getReadinessRunById.mockResolvedValue({ id: 'run-1' } as ReleaseReadinessRun);
    repository.getGateResultsForRun.mockResolvedValue([
      { id: 'gate-1', status: 'FAIL' } as ReleaseReadinessGateResult
    ]);

    await useCase.execute('gate-1', 'run-1', 'reason', 'admin-1', []);

    expect(repository.acknowledgeGate).toHaveBeenCalledWith('gate-1', 'run-1', 'admin-1', 'reason');
    expect(auditRepository.recordGateAcknowledged).toHaveBeenCalledWith('admin-1', 'gate-1', 'run-1');
  });
});
