import { ControlledActivationExecutionPlanRepository } from '../../ports/activation/ControlledActivationExecutionPlanRepository.js';
import { LIVE_REVIEW_CHECKABLE_STATUSES, liveReviewHasBlockers } from '@goldplus/shared';
import { randomUUID } from 'crypto';
import { ControlledActivationLiveReviewRepository, LiveReadinessCheck } from '../../ports/activation/ControlledActivationLiveReviewRepository';
import { ControlledActivationDryRunRepository } from '../../ports/activation/ControlledActivationDryRunRepository';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository';
import { ControlledActivationLiveReadinessChecker } from '../../ports/activation/ControlledActivationLiveReadinessChecker';
import { BuildControlledActivationEvidencePackUseCase } from './BuildControlledActivationEvidencePackUseCase';
import { ControlledActivationCanaryPlanner } from '../../ports/activation/ControlledActivationCanaryPlanner';
import { DomainError } from '../../../domain/errors/DomainError';

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
    private executionPlanRepository: ControlledActivationExecutionPlanRepository,
    private evidencePackBuilder: BuildControlledActivationEvidencePackUseCase,
    private canaryPlanner: ControlledActivationCanaryPlanner
  ) {}

  async execute(command: RunLiveReadinessChecksCommand): Promise<LiveReadinessCheck[]> {
    if (!command.adminId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'adminId is required');
    if (!command.candidateId) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'candidateId is required');

    if (!this.accessPolicy.canViewActivation(command.adminId)) {
      throw new DomainError('LIVE_REVIEW_FORBIDDEN', 'FORBIDDEN', `Admin ${command.adminId} is not authorized to run live readiness checks.`);
    }

    const candidate = await this.liveReviewRepository.getCandidateById(command.candidateId);
    if (!candidate) {
      throw new DomainError('LIVE_REVIEW_NOT_FOUND', 'NOT_FOUND', `Candidate ${command.candidateId} not found.`);
    }

    if (!LIVE_REVIEW_CHECKABLE_STATUSES.includes(candidate.status)) {
      throw new DomainError('LIVE_REVIEW_STATE_CONFLICT', 'CONFLICT', `Cannot run checks on a candidate in status: ${candidate.status}`);
    }

    const dryRun = await this.dryRunRepository.getDryRun(candidate.dryRunId);
    if (!dryRun) {
      throw new DomainError('LIVE_REVIEW_NOT_FOUND', 'NOT_FOUND', `Dry run ${candidate.dryRunId} not found.`);
    }

    const executionPlan = await this.executionPlanRepository.getExecutionPlan(candidate.executionPlanId);
    if(!executionPlan) {
        throw new DomainError('LIVE_REVIEW_NOT_FOUND', 'NOT_FOUND', 'Execution plan not found');
    }

    const evidencePack = await this.evidencePackBuilder.execute(dryRun.id, candidate.activationRequestId);

    const canaryPlan = await this.canaryPlanner.getCanaryPlan(executionPlan.id);
    if (!canaryPlan) throw new DomainError('LIVE_REVIEW_INVALID', 'VALIDATION', 'Canary plan is missing');

    const checks = await this.liveReadinessChecker.checkReadiness(
      candidate.id,
      dryRun,
      evidencePack,
      canaryPlan,
      candidate.activationWindowStart,
      candidate.activationWindowEnd
    );

    await this.liveReviewRepository.saveReadinessChecks(checks);

    const hasBlockers = liveReviewHasBlockers(checks);
    
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
