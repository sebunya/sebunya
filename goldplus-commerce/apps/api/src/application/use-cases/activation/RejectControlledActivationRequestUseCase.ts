import { ControlledActivationRepository } from '../../ports/activation/ControlledActivationRepository.js';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository.js';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy.js';
import { ActivationStakeholderApprovalRepository } from '../../ports/activation/ActivationStakeholderApprovalRepository.js';

export interface RejectRequestCommand {
  adminId: string;
  activationRequestId: string;
  reason: string;
}

export class RejectControlledActivationRequestUseCase {
  constructor(
    private readonly repository: ControlledActivationRepository,
    private readonly auditRepo: ControlledActivationAuditRepository,
    private readonly accessPolicy: ControlledActivationAccessPolicy,
    private readonly approvalRepo: ActivationStakeholderApprovalRepository
  ) {}

  async execute(command: RejectRequestCommand): Promise<void> {
    const canReject = await this.accessPolicy.canRejectActivation(command.adminId);
    if (!canReject) throw new Error('Forbidden: Cannot reject activation');
    
    if (!command.reason) throw new Error('Rejection reason is required');

    const request = await this.repository.getActivationRequest(command.activationRequestId);
    if (!request) throw new Error('Activation request not found');

    await this.approvalRepo.recordApproval({
      activationRequestId: command.activationRequestId,
      approverAdminId: command.adminId,
      approvalStatus: 'REJECTED',
      approvalNote: command.reason
    });

    await this.repository.updateActivationRequestStatus(request.id, 'BLOCKED', command.reason);

    await this.auditRepo.recordAuditEvent({
      activationRequestId: request.id,
      actorAdminId: command.adminId,
      action: 'REJECTED_REQUEST',
      safePayload: JSON.stringify({ reason: command.reason })
    });
  }
}
