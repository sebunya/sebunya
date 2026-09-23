import { randomUUID } from 'crypto';
import { ControlledActivationLiveReviewRepository } from '../../ports/activation/ControlledActivationLiveReviewRepository';
import { ControlledActivationOperatorChecklistRepository } from '../../ports/activation/ControlledActivationOperatorChecklistRepository';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository';
import { DomainError } from '../../../domain/errors/DomainError';

export interface RecordOperatorAcknowledgementCommand {
  adminId: string;
  candidateId: string;
  checklistId: string;
  acknowledgementNote: string;
}

export class RecordControlledActivationOperatorAcknowledgementUseCase {
  constructor(
    private liveReviewRepository: ControlledActivationLiveReviewRepository,
    private checklistRepository: ControlledActivationOperatorChecklistRepository,
    private accessPolicy: ControlledActivationAccessPolicy,
    private auditRepository: ControlledActivationAuditRepository
  ) {}

  async execute(command: RecordOperatorAcknowledgementCommand): Promise<void> {
    if (!command.adminId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'adminId is required');
    if (!command.candidateId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'candidateId is required');
    if (!command.checklistId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'checklistId is required');
    if (!command.acknowledgementNote) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'acknowledgementNote is required');

    if (!this.accessPolicy.canViewActivation(command.adminId)) {
      throw new DomainError('LIVE_REVIEW_FORBIDDEN', 'FORBIDDEN', `Admin ${command.adminId} is not authorized to acknowledge operator checklists.`);
    }

    const candidate = await this.liveReviewRepository.getCandidateById(command.candidateId);
    if (!candidate) {
      throw new DomainError('LIVE_REVIEW_NOT_FOUND', 'NOT_FOUND', `Candidate ${command.candidateId} not found.`);
    }
    
    if (candidate.status !== 'APPROVED_FOR_FUTURE_CONTROLLED_ACTIVATION') {
      throw new DomainError('LIVE_REVIEW_STATE_CONFLICT', 'CONFLICT', `Cannot acknowledge operator checklist for candidate in status: ${candidate.status}`);
    }

    const checklist = await this.checklistRepository.getChecklistByCandidateId(command.candidateId);
    if (!checklist || checklist.id !== command.checklistId) {
      throw new DomainError('LIVE_REVIEW_NOT_FOUND', 'NOT_FOUND', `Checklist not found or does not match candidate.`);
    }

    const hasPendingItems = checklist.items.some(item => item.required && item.status === 'PENDING');
    if (hasPendingItems) {
      throw new DomainError('LIVE_REVIEW_STATE_CONFLICT', 'CONFLICT', 'Cannot acknowledge operator checklist. Required items are pending.');
    }

    checklist.checklistStatus = 'COMPLETED';
    checklist.acknowledgedAt = new Date();
    checklist.operatorAdminId = command.adminId;

    await this.checklistRepository.updateChecklist(checklist);

    await this.auditRepository.recordAuditEvent({
      action: 'OPERATOR_CHECKLIST_ACKNOWLEDGED',
      safePayload: JSON.stringify({ checklistId: command.checklistId, candidateId: command.candidateId }),
      actorAdminId: command.adminId,
      activationRequestId: candidate.activationRequestId,
    });
  }
}
