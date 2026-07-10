import { randomUUID } from 'crypto';
import { ControlledActivationLiveReviewRepository } from '../../ports/activation/ControlledActivationLiveReviewRepository';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository';

export interface ExpireLiveReviewCandidateCommand {
  adminId: string;
  candidateId: string;
  expiryReason: string;
}

export class ExpireControlledActivationLiveReviewCandidateUseCase {
  constructor(
    private liveReviewRepository: ControlledActivationLiveReviewRepository,
    private auditRepository: ControlledActivationAuditRepository
  ) {}

  async execute(command: ExpireLiveReviewCandidateCommand): Promise<void> {
    if (!command.adminId) throw new Error('adminId is required');
    if (!command.candidateId) throw new Error('candidateId is required');
    if (!command.expiryReason) throw new Error('expiryReason is required');

    const candidate = await this.liveReviewRepository.getCandidateById(command.candidateId);
    if (!candidate) {
      throw new Error(`Candidate ${command.candidateId} not found.`);
    }

    if (candidate.status === 'CANCELLED' || candidate.status === 'EXPIRED') {
      return; // Idempotent
    }

    await this.liveReviewRepository.updateCandidateStatus(command.candidateId, 'EXPIRED');

    await this.auditRepository.recordAuditEvent({
      action: 'LIVE_REVIEW_CANDIDATE_EXPIRED',
      safePayload: JSON.stringify({ candidateId: command.candidateId, reason: command.expiryReason }),
      actorAdminId: command.adminId,
      activationRequestId: candidate.activationRequestId,
    });
  }
}
