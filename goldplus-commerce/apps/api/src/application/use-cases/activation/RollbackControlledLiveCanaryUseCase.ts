import { ControlledLiveCanary, ControlledLiveCanaryRepository } from '../../ports/activation/ControlledLiveCanaryRepository.js';
import { ControlledLiveCanaryAuditRepository } from '../../ports/activation/ControlledLiveCanaryAuditRepository.js';

export interface RollbackCanaryInput {
  canaryId: string;
  reason: string;
  rollbackOwner: string;
  actorAdminId: string;
}

export class RollbackControlledLiveCanaryUseCase {
  constructor(
    private canaryRepo: ControlledLiveCanaryRepository,
    private auditRepo: ControlledLiveCanaryAuditRepository
  ) {}

  async execute(input: RollbackCanaryInput): Promise<ControlledLiveCanary> {
    const canary = await this.canaryRepo.getCanary(input.canaryId);
    if (!canary) {
      throw new Error('CANARY_NOT_FOUND');
    }

    const updated = await this.canaryRepo.updateCanary(canary.id, {
      status: 'CANARY_ROLLED_BACK',
      rollbackReason: input.reason,
      rollbackOwner: input.rollbackOwner
    });

    await this.auditRepo.recordAuditEvent({
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      canaryId: canary.id,
      action: 'ROLLBACK_CONTROLLED_CANARY',
      actorAdminId: input.actorAdminId,
      reason: input.reason
    });

    return updated;
  }
}
