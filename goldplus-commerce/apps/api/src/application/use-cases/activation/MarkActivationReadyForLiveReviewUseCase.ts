import { ControlledActivationExecutionPlanRepository } from '../../ports/activation/ControlledActivationExecutionPlanRepository.js';
import { ControlledActivationDryRunRepository } from '../../ports/activation/ControlledActivationDryRunRepository.js';
import { ControlledActivationEvidencePackBuilder } from '../../ports/activation/ControlledActivationEvidencePackBuilder.js';
import { ControlledActivationPayloadPreviewer } from '../../ports/activation/ControlledActivationPayloadPreviewer.js';
import { ControlledActivationReadinessChecker } from '../../ports/activation/ControlledActivationReadinessChecker.js';

export interface MarkActivationReadyForLiveReviewCommand {
  adminId: string;
  executionPlanId: string;
}

export class MarkActivationReadyForLiveReviewUseCase {
  constructor(
    private executionPlanRepo: ControlledActivationExecutionPlanRepository,
    private dryRunRepo: ControlledActivationDryRunRepository,
    private evidencePackBuilder: ControlledActivationEvidencePackBuilder,
    private previewer: ControlledActivationPayloadPreviewer,
    private readinessChecker: ControlledActivationReadinessChecker
  ) {}

  async execute(command: MarkActivationReadyForLiveReviewCommand): Promise<void> {
    const plan = await this.executionPlanRepo.getExecutionPlan(command.executionPlanId);
    if (!plan) throw new Error('Execution plan not found.');

    const dryRuns = await this.dryRunRepo.getDryRunsForPlan(plan.id);
    const passedDryRun = dryRuns.find(dr => dr.status === 'PASSED');
    if (!passedDryRun) {
      throw new Error('A PASSED dry-run is required before marking ready for live review.');
    }

    const evidencePack = await this.evidencePackBuilder.getEvidencePack(passedDryRun.id);
    if (!evidencePack) {
      throw new Error('An evidence pack is required before marking ready for live review.');
    }

    const previews = await this.previewer.getPreviewsForDryRun(passedDryRun.id);
    if (previews.some(p => p.status === 'BLOCKED' || p.status === 'INVALID')) {
      throw new Error('Cannot mark ready for live review while there are BLOCKED destination previews.');
    }

    const gates = await this.readinessChecker.runChecks(plan.activationRequestId);
    if (gates.some(g => g.status === 'FAIL')) {
      throw new Error('Cannot mark ready for live review while critical FAIL gates exist.');
    }

    await this.executionPlanRepo.updateExecutionPlanStatus(plan.id, 'READY_FOR_LIVE_REVIEW');
  }
}
