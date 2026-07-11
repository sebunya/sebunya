import { ControlledLiveCanary, ControlledLiveCanaryRepository } from '../../ports/activation/ControlledLiveCanaryRepository.js';
import { ControlledLiveCanaryAuditRepository } from '../../ports/activation/ControlledLiveCanaryAuditRepository.js';

export interface PauseCanaryInput {
  canaryId: string;
  reason: string;
  pausedByAdminId: string;
}

export class PauseControlledLiveCanaryUseCase {
  constructor(
    private canaryRepo: ControlledLiveCanaryRepository,
    private auditRepo: ControlledLiveCanaryAuditRepository
  ) {}

  async execute(input: PauseCanaryInput): Promise<ControlledLiveCanary> {
    const canary = await this.canaryRepo.getCanary(input.canaryId);
    if (!canary) {
      throw new Error('CANARY_NOT_FOUND');
    }

    if (canary.status !== 'CANARY_RUNNING') {
      throw new Error('CANARY_NOT_RUNNING');
    }

    const updated = await this.canaryRepo.updateCanary(canary.id, {
      status: 'CANARY_PAUSED'
    });

    await this.auditRepo.recordAuditEvent({
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      canaryId: canary.id,
      action: 'PAUSE_CONTROLLED_CANARY',
      actorAdminId: input.pausedByAdminId,
      reason: input.reason
    });

    return updated;
  }
}
