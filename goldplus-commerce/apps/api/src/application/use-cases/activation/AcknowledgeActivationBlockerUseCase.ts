import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy.js';
import { ControlledActivationReadinessChecker } from '../../ports/activation/ControlledActivationReadinessChecker.js';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository.js';

export interface AcknowledgeBlockerCommand {
  adminId: string;
  activationRequestId: string;
  gateId: string;
  reason: string;
}

export class AcknowledgeActivationBlockerUseCase {
  constructor(
    private readonly accessPolicy: ControlledActivationAccessPolicy,
    private readonly checker: ControlledActivationReadinessChecker,
    private readonly auditRepo: ControlledActivationAuditRepository
  ) {}

  async execute(command: AcknowledgeBlockerCommand): Promise<void> {
    const canAck = await this.accessPolicy.canAcknowledgeActivationBlocker(command.adminId);
    if (!canAck) throw new Error('Forbidden: Cannot acknowledge blocker');

    if (!command.reason) throw new Error('Reason is required');

    await this.checker.acknowledgeBlocker(command.activationRequestId, command.gateId, command.reason);

    await this.auditRepo.recordAuditEvent({
      activationRequestId: command.activationRequestId,
      actorAdminId: command.adminId,
      action: 'ACKNOWLEDGED_BLOCKER',
      safePayload: JSON.stringify({ gateId: command.gateId, reason: command.reason })
    });
  }
}
