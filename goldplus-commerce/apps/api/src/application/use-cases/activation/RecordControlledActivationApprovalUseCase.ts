import { ControlledActivationRepository } from '../../ports/activation/ControlledActivationRepository.js';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository.js';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy.js';
import { ControlledActivationReadinessChecker } from '../../ports/activation/ControlledActivationReadinessChecker.js';
import { ActivationStakeholderApprovalRepository } from '../../ports/activation/ActivationStakeholderApprovalRepository.js';

export interface RecordApprovalCommand {
  adminId: string;
  activationRequestId: string;
  approvalNote: string;
}

export class RecordControlledActivationApprovalUseCase {
  constructor(
    private readonly repository: ControlledActivationRepository,
    private readonly auditRepo: ControlledActivationAuditRepository,
    private readonly accessPolicy: ControlledActivationAccessPolicy,
    private readonly checker: ControlledActivationReadinessChecker,
    private readonly approvalRepo: ActivationStakeholderApprovalRepository
  ) {}

  async execute(command: RecordApprovalCommand): Promise<void> {
    const canApprove = await this.accessPolicy.canApproveActivation(command.adminId);
    if (!canApprove) {
      throw new Error('Forbidden: Cannot approve activation');
    }

    if (!command.approvalNote) {
      throw new Error('Approval note is required');
    }

    const request = await this.repository.getActivationRequest(command.activationRequestId);
    if (!request) {
      throw new Error('Activation request not found');
    }

    if (!request.rollbackPlanSummary) throw new Error('Cannot approve without rollback plan');
    if (!request.monitoringOwner) throw new Error('Cannot approve without monitoring owner');
    if (!request.requestedWindowStart || !request.requestedWindowEnd) throw new Error('Cannot approve without activation window');

    const gates = await this.checker.getLatestGates(command.activationRequestId);
    if (gates.length === 0) {
      throw new Error('Cannot approve without running Release Readiness checks');
    }

    const hasCriticalFail = gates.some(g => g.status === 'FAIL' && g.severity === 'CRITICAL');
    if (hasCriticalFail) throw new Error('Cannot approve with critical FAIL gates');

    const hasBlocked = gates.some(g => g.status === 'BLOCKED');
    if (hasBlocked) throw new Error('Cannot approve with BLOCKED gates');

    await this.approvalRepo.recordApproval({
      activationRequestId: command.activationRequestId,
      approverAdminId: command.adminId,
      approvalStatus: 'APPROVED',
      approvalNote: command.approvalNote
    });

    await this.repository.updateActivationRequestStatus(request.id, 'APPROVED_FOR_CONTROLLED_ACTIVATION', command.approvalNote);

    await this.auditRepo.recordAuditEvent({
      activationRequestId: request.id,
      actorAdminId: command.adminId,
      action: 'APPROVED_REQUEST',
      safePayload: JSON.stringify({ note: command.approvalNote })
    });
  }
}
