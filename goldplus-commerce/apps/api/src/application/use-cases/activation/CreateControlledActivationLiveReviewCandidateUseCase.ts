import { randomUUID } from 'crypto';
import { ControlledActivationLiveReviewRepository, LiveReviewCandidate } from '../../ports/activation/ControlledActivationLiveReviewRepository';
import { ControlledActivationDryRunRepository } from '../../ports/activation/ControlledActivationDryRunRepository';
import { ControlledActivationExecutionPlanRepository } from '../../ports/activation/ControlledActivationExecutionPlanRepository';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository';

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
    if (!command.adminId) throw new Error('adminId is required');
    if (!command.activationRequestId) throw new Error('activationRequestId is required');
    if (!command.executionPlanId) throw new Error('executionPlanId is required');
    if (!command.dryRunId) throw new Error('dryRunId is required');
    if (!command.evidencePackId) throw new Error('evidencePackId is required');
    if (!command.canaryScopeSummary) throw new Error('canaryScopeSummary is required');
    if (!command.rollbackOwner) throw new Error('rollbackOwner is required');
    if (!command.monitoringOwner) throw new Error('monitoringOwner is required');
    if (!command.incidentOwner) throw new Error('incidentOwner is required');
    if (!command.activationWindowStart || !command.activationWindowEnd) throw new Error('Activation window bounds are required');

    if (!this.accessPolicy.canViewActivation(command.adminId)) {
      throw new Error(`Admin ${command.adminId} is not authorized to create live review candidates.`);
    }

    const dryRun = await this.dryRunRepository.getDryRun(command.dryRunId);
    if (!dryRun) {
      throw new Error(`Dry run ${command.dryRunId} not found.`);
    }

    if (dryRun.status !== 'PASSED') {
      throw new Error(`Cannot create live review candidate for a dry run that has not PASSED (Current status: ${dryRun.status})`);
    }

    const executionPlan = await this.executionPlanRepository.getExecutionPlan(command.executionPlanId);
    if (!executionPlan) {
      throw new Error(`Execution plan ${command.executionPlanId} not found.`);
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

    await this.auditRepository.recordAuditEvent({ action: "ACTION", safePayload: "payload", actorAdminId: "admin", activationRequestId: "req" });

    return candidate;
  }
}
