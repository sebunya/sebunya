import { randomUUID } from 'crypto';
import { ControlledActivationLiveReviewRepository, LiveReviewCandidate } from '../../ports/activation/ControlledActivationLiveReviewRepository';
import { ControlledActivationDryRunRepository } from '../../ports/activation/ControlledActivationDryRunRepository';
import { ControlledActivationExecutionPlanRepository } from '../../ports/activation/ControlledActivationExecutionPlanRepository';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository';
import { DomainError } from '../../../domain/errors/DomainError';

export interface CreateLiveReviewCandidateCommand {
  adminId: string;
  activationRequestId: string;
  executionPlanId: string;
  dryRunId: string;
  evidencePackId: string;
  environment: string;
  activationWindowStart: Date;
  activationWindowEnd: Date;
  canaryScopeSummary: string;
  monitoringOwner: string;
  incidentOwner: string;
  rollbackOwner: string;
}

export class CreateControlledActivationLiveReviewCandidateUseCase {
  constructor(
    private liveReviewRepository: ControlledActivationLiveReviewRepository,
    private dryRunRepository: ControlledActivationDryRunRepository,
    private executionPlanRepository: ControlledActivationExecutionPlanRepository,
    private accessPolicy: ControlledActivationAccessPolicy,
    private auditRepository: ControlledActivationAuditRepository
  ) {}

  async execute(command: CreateLiveReviewCandidateCommand): Promise<LiveReviewCandidate> {
    if (!command.adminId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'adminId is required');
    if (!command.activationRequestId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'activationRequestId is required');
    if (!command.executionPlanId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'executionPlanId is required');
    if (!command.dryRunId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'dryRunId is required');
    if (!command.evidencePackId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'evidencePackId is required');
    if (!command.canaryScopeSummary) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'canaryScopeSummary is required');
    if (!command.rollbackOwner) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'rollbackOwner is required');
    if (!command.monitoringOwner) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'monitoringOwner is required');
    if (!command.incidentOwner) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'incidentOwner is required');
    if (!command.activationWindowStart || !command.activationWindowEnd) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'Activation window bounds are required');

    if (!this.accessPolicy.canViewActivation(command.adminId)) {
      throw new DomainError('LIVE_REVIEW_FORBIDDEN', 'FORBIDDEN', `Admin ${command.adminId} is not authorized to create live review candidates.`);
    }

    const dryRun = await this.dryRunRepository.getDryRun(command.dryRunId);
    if (!dryRun) {
      throw new DomainError('LIVE_REVIEW_NOT_FOUND', 'NOT_FOUND', `Dry run ${command.dryRunId} not found.`);
    }

    if (dryRun.status !== 'PASSED') {
      throw new DomainError('LIVE_REVIEW_STATE_CONFLICT', 'CONFLICT', `Cannot create live review candidate for a dry run that has not PASSED (Current status: ${dryRun.status})`);
    }

    const executionPlan = await this.executionPlanRepository.getExecutionPlan(command.executionPlanId);
    if (!executionPlan) {
      throw new DomainError('LIVE_REVIEW_NOT_FOUND', 'NOT_FOUND', `Execution plan ${command.executionPlanId} not found.`);
    }

    const candidate: LiveReviewCandidate = {
      id: randomUUID(),
      activationRequestId: command.activationRequestId,
      executionPlanId: command.executionPlanId,
      dryRunId: command.dryRunId,
      evidencePackId: command.evidencePackId,
      createdByAdminId: command.adminId,
      status: 'READY_FOR_REVIEW',
      environment: command.environment,
      activationWindowStart: command.activationWindowStart,
      activationWindowEnd: command.activationWindowEnd,
      canaryScopeSummary: command.canaryScopeSummary,
      monitoringOwner: command.monitoringOwner,
      incidentOwner: command.incidentOwner,
      rollbackOwner: command.rollbackOwner,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.liveReviewRepository.createCandidate(candidate);

    await this.auditRepository.recordAuditEvent({
      action: 'LIVE_REVIEW_CANDIDATE_CREATED',
      safePayload: JSON.stringify({ candidateId: candidate.id, dryRunId: command.dryRunId, evidencePackId: command.evidencePackId }),
      actorAdminId: command.adminId,
      activationRequestId: command.activationRequestId,
    });

    return candidate;
  }
}
