import { randomUUID } from 'crypto';
import { ControlledActivationLiveReviewRepository } from '../../ports/activation/ControlledActivationLiveReviewRepository';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository';
import { DomainError } from '../../../domain/errors/DomainError';

export interface CancelLiveReviewCandidateCommand {
  adminId: string;
  candidateId: string;
  cancellationReason: string;
}

export class CancelControlledActivationLiveReviewCandidateUseCase {
  constructor(
    private liveReviewRepository: ControlledActivationLiveReviewRepository,
    private accessPolicy: ControlledActivationAccessPolicy,
    private auditRepository: ControlledActivationAuditRepository
  ) {}

  async execute(command: CancelLiveReviewCandidateCommand): Promise<void> {
    if (!command.adminId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'adminId is required');
    if (!command.candidateId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'candidateId is required');
    if (!command.cancellationReason) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'cancellationReason is required');

    if (!this.accessPolicy.canViewActivation(command.adminId)) {
      throw new DomainError('LIVE_REVIEW_FORBIDDEN', 'FORBIDDEN', `Admin ${command.adminId} is not authorized to cancel candidates.`);
    }

    const candidate = await this.liveReviewRepository.getCandidateById(command.candidateId);
    if (!candidate) {
      throw new DomainError('LIVE_REVIEW_NOT_FOUND', 'NOT_FOUND', `Candidate ${command.candidateId} not found.`);
    }

    if (candidate.status === 'CANCELLED' || candidate.status === 'EXPIRED') {
      throw new DomainError('LIVE_REVIEW_STATE_CONFLICT', 'CONFLICT', `Candidate is already ${candidate.status}`);
    }

    await this.liveReviewRepository.updateCandidateStatus(command.candidateId, 'CANCELLED');

    await this.auditRepository.recordAuditEvent({
      action: 'LIVE_REVIEW_CANDIDATE_CANCELLED',
      safePayload: JSON.stringify({ candidateId: command.candidateId, reason: command.cancellationReason }),
      actorAdminId: command.adminId,
      activationRequestId: candidate.activationRequestId,
    });
  }
}
