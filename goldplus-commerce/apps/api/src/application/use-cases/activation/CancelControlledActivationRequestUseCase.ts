import { ControlledActivationRepository } from '../../ports/activation/ControlledActivationRepository.js';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository.js';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy.js';

export interface CancelRequestCommand {
  adminId: string;
  activationRequestId: string;
  reason: string;
}

export class CancelControlledActivationRequestUseCase {
  constructor(
    private readonly repository: ControlledActivationRepository,
    private readonly auditRepo: ControlledActivationAuditRepository,
    private readonly accessPolicy: ControlledActivationAccessPolicy
  ) {}

  async execute(command: CancelRequestCommand): Promise<void> {
    const canCancel = await this.accessPolicy.canCancelActivation(command.adminId);
    if (!canCancel) throw new Error('Forbidden: Cannot cancel activation');

    if (!command.reason) throw new Error('Cancellation reason is required');

    const request = await this.repository.getActivationRequest(command.activationRequestId);
    if (!request) throw new Error('Activation request not found');

    await this.repository.updateActivationRequestStatus(request.id, 'CANCELLED', command.reason);

    await this.auditRepo.recordAuditEvent({
      activationRequestId: request.id,
      actorAdminId: command.adminId,
      action: 'CANCELLED_REQUEST',
      safePayload: JSON.stringify({ reason: command.reason })
    });
  }
}
