import { ControlledActivationLiveReviewRepository, LiveReviewCandidate, LiveReadinessCheck } from '../../ports/activation/ControlledActivationLiveReviewRepository';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy';
import { ControlledActivationOperatorChecklistRepository, OperatorChecklist } from '../../ports/activation/ControlledActivationOperatorChecklistRepository';
import { ControlledActivationRunbookBuilder, CanaryRunbook } from '../../ports/activation/ControlledActivationRunbookBuilder';
import { ControlledActivationStakeholderLiveApprovalRepository, StakeholderLiveApproval } from '../../ports/activation/ControlledActivationStakeholderLiveApprovalRepository';
import { ControlledActivationIncidentPlanRepository, ControlledActivationIncidentPlan } from '../../ports/activation/ControlledActivationIncidentPlanRepository';
import { DomainError } from '../../../domain/errors/DomainError';

export interface GetLiveReviewCandidateCommand {
  adminId: string;
  candidateId: string;
}

export interface LiveReviewCandidateDetails {
  candidate: LiveReviewCandidate;
  checks: LiveReadinessCheck[];
  checklist: OperatorChecklist | null;
  runbook: CanaryRunbook | null;
  approvals: StakeholderLiveApproval[];
  incidentPlan: ControlledActivationIncidentPlan | null;
}

export class GetControlledActivationLiveReviewCandidateUseCase {
  constructor(
    private liveReviewRepository: ControlledActivationLiveReviewRepository,
    private checklistRepository: ControlledActivationOperatorChecklistRepository,
    private runbookBuilder: ControlledActivationRunbookBuilder,
    private approvalRepository: ControlledActivationStakeholderLiveApprovalRepository,
    private incidentPlanRepository: ControlledActivationIncidentPlanRepository,
    private accessPolicy: ControlledActivationAccessPolicy
  ) {}

  async execute(command: GetLiveReviewCandidateCommand): Promise<LiveReviewCandidateDetails> {
    if (!command.adminId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'adminId is required');
    if (!command.candidateId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'candidateId is required');

    if (!this.accessPolicy.canViewActivation(command.adminId)) {
      throw new DomainError('LIVE_REVIEW_FORBIDDEN', 'FORBIDDEN', `Admin ${command.adminId} is not authorized to view live review candidates.`);
    }

    const candidate = await this.liveReviewRepository.getCandidateById(command.candidateId);
    if (!candidate) {
      throw new DomainError('LIVE_REVIEW_NOT_FOUND', 'NOT_FOUND', `Candidate ${command.candidateId} not found.`);
    }

    const checks = await this.liveReviewRepository.getReadinessChecksByCandidateId(command.candidateId);
    const checklist = await this.checklistRepository.getChecklistByCandidateId(command.candidateId);
    const runbook = await this.runbookBuilder.getRunbookByCandidateId(command.candidateId);
    const approvals = await this.approvalRepository.getApprovalsByCandidateId(command.candidateId);
    const incidentPlan = await this.incidentPlanRepository.getIncidentPlanByCandidateId(command.candidateId);

    return {
      candidate,
      checks,
      checklist,
      runbook,
      approvals,
      incidentPlan
    };
  }
}
