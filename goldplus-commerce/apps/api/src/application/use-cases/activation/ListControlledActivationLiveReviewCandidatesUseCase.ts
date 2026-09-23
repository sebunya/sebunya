import { ControlledActivationLiveReviewRepository, LiveReviewCandidate } from '../../ports/activation/ControlledActivationLiveReviewRepository';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy';
import { DomainError } from '../../../domain/errors/DomainError';

export interface ListLiveReviewCandidatesCommand {
  adminId: string;
}

export class ListControlledActivationLiveReviewCandidatesUseCase {
  constructor(
    private liveReviewRepository: ControlledActivationLiveReviewRepository,
    private accessPolicy: ControlledActivationAccessPolicy
  ) {}

  async execute(command: ListLiveReviewCandidatesCommand): Promise<LiveReviewCandidate[]> {
    if (!command.adminId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'adminId is required');

    if (!this.accessPolicy.canViewActivation(command.adminId)) {
      throw new DomainError('LIVE_REVIEW_FORBIDDEN', 'FORBIDDEN', `Admin ${command.adminId} is not authorized to list candidates.`);
    }

    return this.liveReviewRepository.listCandidates();
  }
}
