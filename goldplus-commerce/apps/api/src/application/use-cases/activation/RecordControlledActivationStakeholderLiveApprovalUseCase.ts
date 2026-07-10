import { randomUUID } from 'crypto';
import { ControlledActivationLiveReviewRepository } from '../../ports/activation/ControlledActivationLiveReviewRepository';
import { ControlledActivationStakeholderLiveApprovalRepository } from '../../ports/activation/ControlledActivationStakeholderLiveApprovalRepository';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository';

export interface RecordStakeholderLiveApprovalCommand {
  adminId: string;
  candidateId: string;
  approvalStatus: 'APPROVED' | 'REJECTED' | 'NEEDS_CHANGES';
  approvalNote: string;
}

export class RecordControlledActivationStakeholderLiveApprovalUseCase {
  constructor(
    private liveReviewRepository: ControlledActivationLiveReviewRepository,
    private approvalRepository: ControlledActivationStakeholderLiveApprovalRepository,
    private accessPolicy: ControlledActivationAccessPolicy,
    private auditRepository: ControlledActivationAuditRepository
  ) {}

  async execute(command: RecordStakeholderLiveApprovalCommand): Promise<void> {
    if (!command.adminId) throw new Error('adminId is required');
    if (!command.candidateId) throw new Error('candidateId is required');
    if (!command.approvalStatus) throw new Error('approvalStatus is required');
    if (!command.approvalNote) throw new Error('approvalNote is required');

    if (!this.accessPolicy.canViewActivation(command.adminId)) {
      throw new Error(`Admin ${command.adminId} is not authorized to record live approvals.`);
    }

    const candidate = await this.liveReviewRepository.getCandidateById(command.candidateId);
    if (!candidate) {
      throw new Error(`Candidate ${command.candidateId} not found.`);
    }

    if (candidate.status === 'APPROVED_FOR_FUTURE_CONTROLLED_ACTIVATION') {
      throw new Error('Candidate is already approved for future controlled activation.');
    }

    if (candidate.status === 'BLOCKED') {
      throw new Error('Cannot approve a BLOCKED candidate. Resolve blockers and re-run checks.');
    }
    
    if (candidate.status !== 'READY_FOR_REVIEW') {
       throw new Error(`Cannot approve candidate in status: ${candidate.status}`);
    }

    const checks = await this.liveReviewRepository.getReadinessChecksByCandidateId(command.candidateId);
    if (checks.length === 0) {
      throw new Error('Cannot approve candidate without readiness checks.');
    }
    
    const hasBlockers = checks.some(c => c.status === 'BLOCKED' || c.status === 'EXPIRED' || c.status === 'NOT_CONFIGURED' || c.status === 'CONSENT_BLOCKED');
    if (hasBlockers) {
      throw new Error('Cannot approve candidate with BLOCKED readiness checks.');
    }

    const now = new Date();
    if (now > candidate.activationWindowEnd) {
       throw new Error('Cannot approve candidate. Activation window has expired.');
    }

    await this.approvalRepository.recordApproval({
      id: randomUUID(),
      candidateId: command.candidateId,
      approverAdminId: command.adminId,
      approvalStatus: command.approvalStatus,
      approvalNote: command.approvalNote,
      approvedAt: new Date()
    });

    if (command.approvalStatus === 'APPROVED') {
       await this.liveReviewRepository.updateCandidateStatus(command.candidateId, 'APPROVED_FOR_FUTURE_CONTROLLED_ACTIVATION');
    } else if (command.approvalStatus === 'REJECTED') {
       await this.liveReviewRepository.updateCandidateStatus(command.candidateId, 'CANCELLED');
    }

    await this.auditRepository.recordAuditEvent({
      action: `STAKEHOLDER_LIVE_APPROVAL_${command.approvalStatus}`,
      safePayload: JSON.stringify({ candidateId: command.candidateId, approvalStatus: command.approvalStatus }),
      actorAdminId: command.adminId,
      activationRequestId: candidate.activationRequestId,
    });
  }
}
