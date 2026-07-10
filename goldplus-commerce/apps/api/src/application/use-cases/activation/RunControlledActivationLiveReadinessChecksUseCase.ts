import { randomUUID } from 'crypto';
import { ControlledActivationLiveReviewRepository, LiveReadinessCheck } from '../../ports/activation/ControlledActivationLiveReviewRepository';
import { ControlledActivationDryRunRepository } from '../../ports/activation/ControlledActivationDryRunRepository';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository';
import { ControlledActivationLiveReadinessChecker } from '../../ports/activation/ControlledActivationLiveReadinessChecker';
import { BuildControlledActivationEvidencePackUseCase } from './BuildControlledActivationEvidencePackUseCase';
import { ControlledActivationCanaryPlanner } from '../../ports/activation/ControlledActivationCanaryPlanner';

export interface RunLiveReadinessChecksCommand {
  adminId: string;
  candidateId: string;
}

export class RunControlledActivationLiveReadinessChecksUseCase {
  constructor(
    private liveReviewRepository: ControlledActivationLiveReviewRepository,
    private dryRunRepository: ControlledActivationDryRunRepository,
    private accessPolicy: ControlledActivationAccessPolicy,
    private auditRepository: ControlledActivationAuditRepository,
    private liveReadinessChecker: ControlledActivationLiveReadinessChecker,
    private executionPlanRepository: any,
    private evidencePackBuilder: BuildControlledActivationEvidencePackUseCase,
    private canaryPlanner: ControlledActivationCanaryPlanner
  ) {}

  async execute(command: RunLiveReadinessChecksCommand): Promise<LiveReadinessCheck[]> {
    if (!command.adminId) throw new Error('adminId is required');
    if (!command.candidateId) throw new Error('candidateId is required');

    if (!this.accessPolicy.canViewActivation(command.adminId)) {
      throw new Error(`Admin ${command.adminId} is not authorized to run live readiness checks.`);
    }

    const candidate = await this.liveReviewRepository.getCandidateById(command.candidateId);
    if (!candidate) {
      throw new Error(`Candidate ${command.candidateId} not found.`);
    }

    if (candidate.status !== 'READY_FOR_REVIEW' && candidate.status !== 'BLOCKED') {
      throw new Error(`Cannot run checks on a candidate in status: ${candidate.status}`);
    }

    const dryRun = await this.dryRunRepository.getDryRun(candidate.dryRunId);
    if (!dryRun) {
      throw new Error(`Dry run ${candidate.dryRunId} not found.`);
    }

    const executionPlan = await this.executionPlanRepository.getExecutionPlan(candidate.executionPlanId);
    if(!executionPlan) {
        throw new Error('Execution plan not found');
    }

    const evidencePack = await this.evidencePackBuilder.execute(dryRun.id, candidate.activationRequestId);

    const canaryPlan = await this.canaryPlanner.getCanaryPlan(executionPlan.id);
    if (!canaryPlan) throw new Error('Canary plan is missing');

    const checks = await this.liveReadinessChecker.checkReadiness(
      candidate.id,
      dryRun,
      evidencePack,
      canaryPlan,
      candidate.activationWindowStart,
      candidate.activationWindowEnd
    );

    await this.liveReviewRepository.saveReadinessChecks(checks);

    const hasBlockers = checks.some(c => c.status === 'BLOCKED' || c.status === 'EXPIRED' || c.status === 'NOT_CONFIGURED' || c.status === 'CONSENT_BLOCKED');
    
    if (hasBlockers && candidate.status !== 'BLOCKED') {
      await this.liveReviewRepository.updateCandidateStatus(candidate.id, 'BLOCKED');
    } else if (!hasBlockers && candidate.status === 'BLOCKED') {
      await this.liveReviewRepository.updateCandidateStatus(candidate.id, 'READY_FOR_REVIEW');
    }

    await this.auditRepository.recordAuditEvent({
      activationRequestId: candidate.activationRequestId,
      actorAdminId: command.adminId,
      action: 'RAN_LIVE_READINESS_CHECKS',
      safePayload: `Ran checks. Blockers: ${hasBlockers}`
    });

    return checks;
  }
}
