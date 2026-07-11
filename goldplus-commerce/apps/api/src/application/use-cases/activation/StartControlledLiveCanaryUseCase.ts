import { ControlledLiveCanary, ControlledLiveCanaryRepository } from '../../ports/activation/ControlledLiveCanaryRepository.js';
import { ControlledLiveCanaryTransport, CanaryDeliveryAttempt } from '../../ports/activation/ControlledLiveCanaryTransport.js';
import { ControlledLiveCanaryKillSwitch } from '../../ports/activation/ControlledLiveCanaryKillSwitch.js';
import { ControlledLiveCanaryAuditRepository } from '../../ports/activation/ControlledLiveCanaryAuditRepository.js';

export interface StartCanaryInput {
  canaryId: string;
  confirmationText: string;
  startedByAdminId: string;
}

export class StartControlledLiveCanaryUseCase {
  constructor(
    private canaryRepo: ControlledLiveCanaryRepository,
    private transport: ControlledLiveCanaryTransport,
    private killSwitch: ControlledLiveCanaryKillSwitch,
    private auditRepo: ControlledLiveCanaryAuditRepository
  ) {}

  async execute(input: StartCanaryInput): Promise<{ canary: ControlledLiveCanary; attempt: CanaryDeliveryAttempt }> {
    if (input.confirmationText !== 'START_CONTROLLED_CANARY') {
      throw new Error('INVALID_CONFIRMATION_TEXT');
    }

    const canary = await this.canaryRepo.getCanary(input.canaryId);
    if (!canary) {
      throw new Error('CANARY_NOT_FOUND');
    }

    if (canary.status !== 'READY_FOR_CANARY') {
      throw new Error('CANARY_NOT_ELIGIBLE');
    }

    const isKillSwitched = await this.killSwitch.isKillSwitchTriggered(canary.activationRequestId);
    if (isKillSwitched) {
      await this.canaryRepo.updateCanary(canary.id, { status: 'BLOCKED' });
      throw new Error('KILL_SWITCH_BLOCKED');
    }

    // Update status to CANARY_RUNNING
    const updatedCanary = await this.canaryRepo.updateCanary(canary.id, {
      status: 'CANARY_RUNNING',
      startedAt: new Date()
    });

    // Record audit event
    await this.auditRepo.recordAuditEvent({
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      canaryId: canary.id,
      action: 'START_CONTROLLED_CANARY',
      actorAdminId: input.startedByAdminId,
      reason: 'Controlled Live Canary Started'
    });

    // Dispatch a tiny canary batch
    const destination = canary.destinationAllowlist[0] || 'meta';
    
    // Pass mock payload to map
    const attempt = await this.transport.sendCanary(
      canary.id,
      destination,
      [{ event: 'page_view', properties: { test: true } }],
      canary.canaryCap
    );

    if (attempt.status === 'FAILED' || attempt.status === 'NOT_CONFIGURED' || attempt.status === 'CONSENT_BLOCKED') {
      await this.canaryRepo.updateCanary(canary.id, { status: 'FAILED' });
    }

    return {
      canary: updatedCanary,
      attempt
    };
  }
}
