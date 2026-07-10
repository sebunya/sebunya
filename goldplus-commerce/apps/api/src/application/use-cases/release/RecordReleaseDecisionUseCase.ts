import { IReleaseReadinessRepository, ReleaseDecision } from '../../ports/release/ReleaseReadinessRepository';
import { IReleaseReadinessAccessPolicy } from '../../ports/release/ReleaseReadinessAccessPolicy';
import { IReleaseReadinessAuditRepository } from '../../ports/release/ReleaseReadinessAuditRepository';

export class RecordReleaseDecisionUseCase {
  constructor(
    private readonly repository: IReleaseReadinessRepository,
    private readonly accessPolicy: IReleaseReadinessAccessPolicy,
    private readonly auditRepository: IReleaseReadinessAuditRepository
  ) {}

  async execute(runId: string, status: string, notes: string | undefined, adminUserId: string, adminPermissions: string[]): Promise<ReleaseDecision> {
    if (!this.accessPolicy.canRecordReleaseDecision(adminUserId, adminPermissions)) {
      throw new Error('Unauthorized to record release decision');
    }

    const run = await this.repository.getReadinessRunById(runId);
    if (!run) {
      throw new Error('Run not found');
    }

    if (status === 'APPROVED_FOR_CONTROLLED_ACTIVATION') {
      const gates = await this.repository.getGateResultsForRun(runId);
      const hasCriticalFailures = gates.some(g => (g.status === 'FAIL' || g.status === 'BLOCKED') && g.severity === 'CRITICAL' && !g.acknowledgedAt);
      if (hasCriticalFailures) {
        throw new Error('Cannot approve release with unacknowledged critical failures');
      }
    }

    const decision = await this.repository.recordReleaseDecision(runId, status, adminUserId, notes);
    await this.auditRepository.recordReleaseDecisionRecorded(adminUserId, runId, status);

    return decision;
  }
}
