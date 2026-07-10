import { randomUUID } from 'crypto';
import { ControlledActivationLiveReviewRepository } from '../../ports/activation/ControlledActivationLiveReviewRepository';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository';
import { ControlledActivationRunbookBuilder, CanaryRunbook } from '../../ports/activation/ControlledActivationRunbookBuilder';
import { ControlledActivationCanaryPlanner } from '../../ports/activation/ControlledActivationCanaryPlanner';
import { ControlledActivationExecutionPlanRepository } from '../../ports/activation/ControlledActivationExecutionPlanRepository';
import { ControlledActivationIncidentPlanRepository } from '../../ports/activation/ControlledActivationIncidentPlanRepository';

export interface BuildCanaryRunbookCommand {
  adminId: string;
  candidateId: string;
}

export class BuildControlledActivationRunbookUseCase {
  constructor(
    private liveReviewRepository: ControlledActivationLiveReviewRepository,
    private accessPolicy: ControlledActivationAccessPolicy,
    private auditRepository: ControlledActivationAuditRepository,
    private runbookBuilder: ControlledActivationRunbookBuilder,
    private canaryPlanner: ControlledActivationCanaryPlanner,
    private executionPlanRepository: ControlledActivationExecutionPlanRepository,
    private incidentPlanRepository: ControlledActivationIncidentPlanRepository
  ) {}

  async execute(command: BuildCanaryRunbookCommand): Promise<CanaryRunbook> {
    if (!command.adminId) throw new Error('adminId is required');
    if (!command.candidateId) throw new Error('candidateId is required');

    if (!this.accessPolicy.canViewActivation(command.adminId)) {
      throw new Error(`Admin ${command.adminId} is not authorized to build runbooks.`);
    }

    const candidate = await this.liveReviewRepository.getCandidateById(command.candidateId);
    if (!candidate) {
      throw new Error(`Candidate ${command.candidateId} not found.`);
    }

    const executionPlan = await this.executionPlanRepository.getExecutionPlan(candidate.executionPlanId);
    if (!executionPlan) {
      throw new Error(`Execution plan not found.`);
    }

    const canaryPlan = await this.canaryPlanner.getCanaryPlan(executionPlan.id);
    if (!canaryPlan) throw new Error('Canary plan is missing');
    
    let incidentPlan = await this.incidentPlanRepository.getIncidentPlanByCandidateId(candidate.id);
    if (!incidentPlan) {
      // Create a default incident plan if none exists
      incidentPlan = {
        id: randomUUID(),
        candidateId: candidate.id,
        incidentOwner: candidate.incidentOwner,
        escalationPath: 'STANDARD_ESCALATION',
        rollbackOwner: candidate.rollbackOwner,
        pauseCriteria: 'Data discrepancy > 5% or 500 errors spike',
        rollbackCriteria: 'Data discrepancy > 10% or customer consent failure',
        communicationPlan: 'Update #measurement-control-tower every 30 mins',
        createdAt: new Date()
      };
      await this.incidentPlanRepository.createIncidentPlan(incidentPlan);
    }

    const runbook = await this.runbookBuilder.buildRunbook(candidate.id, canaryPlan, incidentPlan);

    await this.auditRepository.recordAuditEvent({
      action: 'CANARY_RUNBOOK_BUILT',
      safePayload: JSON.stringify({ candidateId: candidate.id }),
      actorAdminId: command.adminId,
      activationRequestId: candidate.activationRequestId,
    });

    return runbook;
  }
}
