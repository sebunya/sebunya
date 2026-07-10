import { IReleaseReadinessRepository } from '../../ports/release/ReleaseReadinessRepository';
import { IReleaseReadinessAccessPolicy } from '../../ports/release/ReleaseReadinessAccessPolicy';
import { IReleaseReadinessAuditRepository } from '../../ports/release/ReleaseReadinessAuditRepository';

export class AcknowledgeReleaseGateUseCase {
  constructor(
    private readonly repository: IReleaseReadinessRepository,
    private readonly accessPolicy: IReleaseReadinessAccessPolicy,
    private readonly auditRepository: IReleaseReadinessAuditRepository
  ) {}

  async execute(gateId: string, runId: string, reason: string, adminUserId: string, adminPermissions: string[]): Promise<void> {
    if (!this.accessPolicy.canAcknowledgeGate(adminUserId, adminPermissions)) {
      throw new Error('Unauthorized to acknowledge release gates');
    }

    if (!reason || reason.trim() === '') {
      throw new Error('Acknowledgement reason is required');
    }

    const run = await this.repository.getReadinessRunById(runId);
    if (!run) {
      throw new Error('Run not found');
    }

    const gates = await this.repository.getGateResultsForRun(runId);
    const gate = gates.find(g => g.id === gateId);
    if (!gate) {
      throw new Error('Gate result not found');
    }

    await this.repository.acknowledgeGate(gateId, runId, adminUserId, reason);
    await this.auditRepository.recordGateAcknowledged(adminUserId, gateId, runId);
  }
}
