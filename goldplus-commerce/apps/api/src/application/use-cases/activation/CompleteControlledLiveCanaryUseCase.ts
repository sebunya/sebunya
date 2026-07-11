import { ControlledLiveCanary, ControlledLiveCanaryRepository } from '../../ports/activation/ControlledLiveCanaryRepository.js';
import { ControlledLiveCanaryAuditRepository } from '../../ports/activation/ControlledLiveCanaryAuditRepository.js';

export interface CompleteCanaryInput {
  canaryId: string;
  completedByAdminId: string;
}

export class CompleteControlledLiveCanaryUseCase {
  constructor(
    private canaryRepo: ControlledLiveCanaryRepository,
    private auditRepo: ControlledLiveCanaryAuditRepository
  ) {}

  async execute(input: CompleteCanaryInput): Promise<ControlledLiveCanary> {
    const canary = await this.canaryRepo.getCanary(input.canaryId);
    if (!canary) {
      throw new Error('CANARY_NOT_FOUND');
    }

    if (canary.status !== 'CANARY_RUNNING' && canary.status !== 'CANARY_PAUSED') {
      throw new Error('CANARY_NOT_RUNNING_OR_PAUSED');
    }

    const updated = await this.canaryRepo.updateCanary(canary.id, {
      status: 'CANARY_COMPLETED',
      completedAt: new Date()
    });

    await this.auditRepo.recordAuditEvent({
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      canaryId: canary.id,
      action: 'COMPLETE_CONTROLLED_CANARY',
      actorAdminId: input.completedByAdminId,
      reason: 'Canary review successfully completed'
    });

    return updated;
  }
}
