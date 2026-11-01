import { randomUUID } from 'crypto';
import { liveReviewHasBlockers } from '@goldplus/shared';
import { ControlledActivationLiveReviewRepository } from '../../ports/activation/ControlledActivationLiveReviewRepository';
import { ControlledActivationStakeholderLiveApprovalRepository } from '../../ports/activation/ControlledActivationStakeholderLiveApprovalRepository';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository';
import { DomainError } from '../../../domain/errors/DomainError';

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
    if (!command.adminId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'adminId is required');
    if (!command.candidateId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'candidateId is required');
    if (!command.approvalStatus) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'approvalStatus is required');
    if (!command.approvalNote) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'approvalNote is required');

    if (!this.accessPolicy.canViewActivation(command.adminId)) {
      throw new DomainError('LIVE_REVIEW_FORBIDDEN', 'FORBIDDEN', `Admin ${command.adminId} is not authorized to record live approvals.`);
    }

    const candidate = await this.liveReviewRepository.getCandidateById(command.candidateId);
    if (!candidate) {
      throw new DomainError('LIVE_REVIEW_NOT_FOUND', 'NOT_FOUND', `Candidate ${command.candidateId} not found.`);
    }

    if (candidate.status === 'APPROVED_FOR_FUTURE_CONTROLLED_ACTIVATION') {
      throw new DomainError('LIVE_REVIEW_STATE_CONFLICT', 'CONFLICT', 'Candidate is already approved for future controlled activation.');
    }

    if (candidate.status === 'BLOCKED') {
      throw new DomainError('LIVE_REVIEW_STATE_CONFLICT', 'CONFLICT', 'Cannot approve a BLOCKED candidate. Resolve blockers and re-run checks.');
    }
    
    if (candidate.status !== 'READY_FOR_REVIEW') {
       throw new DomainError('LIVE_REVIEW_STATE_CONFLICT', 'CONFLICT', `Cannot approve candidate in status: ${candidate.status}`);
    }

    const checks = await this.liveReviewRepository.getReadinessChecksByCandidateId(command.candidateId);
    if (checks.length === 0) {
      throw new DomainError('LIVE_REVIEW_STATE_CONFLICT', 'CONFLICT', 'Cannot approve candidate without readiness checks.');
    }
    
    const hasBlockers = liveReviewHasBlockers(checks);
    if (hasBlockers) {
      throw new DomainError('LIVE_REVIEW_STATE_CONFLICT', 'CONFLICT', 'Cannot approve candidate with BLOCKED readiness checks.');
    }

    const now = new Date();
    if (now > candidate.activationWindowEnd) {
       throw new DomainError('LIVE_REVIEW_STATE_CONFLICT', 'CONFLICT', 'Cannot approve candidate. Activation window has expired.');
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
