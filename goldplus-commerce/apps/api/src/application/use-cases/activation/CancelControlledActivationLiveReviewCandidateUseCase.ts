import { randomUUID } from 'crypto';
import { ControlledActivationLiveReviewRepository } from '../../ports/activation/ControlledActivationLiveReviewRepository';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository';

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
    if (!command.adminId) throw new Error('adminId is required');
    if (!command.candidateId) throw new Error('candidateId is required');
    if (!command.cancellationReason) throw new Error('cancellationReason is required');

    if (!this.accessPolicy.canViewActivation(command.adminId)) {
      throw new Error(`Admin ${command.adminId} is not authorized to cancel candidates.`);
    }

    const candidate = await this.liveReviewRepository.getCandidateById(command.candidateId);
    if (!candidate) {
      throw new Error(`Candidate ${command.candidateId} not found.`);
    }

    if (candidate.status === 'CANCELLED' || candidate.status === 'EXPIRED') {
      throw new Error(`Candidate is already ${candidate.status}`);
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
