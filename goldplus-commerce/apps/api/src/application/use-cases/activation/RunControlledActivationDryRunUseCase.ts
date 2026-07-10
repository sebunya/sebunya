import { randomUUID } from 'crypto';
import {
  ActivationDryRun,
  ControlledActivationDryRunRepository
} from '../../ports/activation/ControlledActivationDryRunRepository.js';
import { ControlledActivationExecutionPlanRepository } from '../../ports/activation/ControlledActivationExecutionPlanRepository.js';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy.js';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository.js';
import { ControlledActivationPayloadPreviewer } from '../../ports/activation/ControlledActivationPayloadPreviewer.js';

export interface RunControlledActivationDryRunCommand {
  adminId: string;
  executionPlanId: string;
}

export class RunControlledActivationDryRunUseCase {
  constructor(
    private dryRunRepo: ControlledActivationDryRunRepository,
    private executionPlanRepo: ControlledActivationExecutionPlanRepository,
    private accessPolicy: ControlledActivationAccessPolicy,
    private auditRepo: ControlledActivationAuditRepository,
    private previewer: ControlledActivationPayloadPreviewer
  ) {}

  async execute(command: RunControlledActivationDryRunCommand): Promise<ActivationDryRun> {
    const hasAccess = await this.accessPolicy.canRunActivationReadinessChecks(command.adminId);
    if (!hasAccess) {
      throw new Error('UNAUTHORIZED');
    }

    const plan = await this.executionPlanRepo.getExecutionPlan(command.executionPlanId);
    if (!plan) {
      throw new Error('Execution plan not found.');
    }

    if (plan.status !== 'READY_FOR_DRY_RUN') {
      throw new Error('Execution plan must be READY_FOR_DRY_RUN.');
    }

    await this.executionPlanRepo.updateExecutionPlanStatus(plan.id, 'DRY_RUN_RUNNING');

    const dryRun = await this.dryRunRepo.createDryRun({
      id: randomUUID(),
      executionPlanId: plan.id,
      activationRequestId: plan.activationRequestId,
      startedByAdminId: command.adminId,
      status: 'RUNNING',
      completedAt: null,
      summary: null,
      blockerCount: 0,
      warningCount: 0,
      redactedEvidenceRef: null
    });

    try {
      // Run preview generation, which is explicitly guaranteed not to send data externally
      const previews = await this.previewer.generatePreviews(dryRun.id, plan.activationRequestId);
      
      const blockers = previews.filter(p => p.status === 'BLOCKED' || p.status === 'INVALID');
      const blockerCount = blockers.length;

      let finalStatus: 'PASSED' | 'BLOCKED' = 'PASSED';
      if (blockerCount > 0) {
        finalStatus = 'BLOCKED';
      }

      const completedDryRun = await this.dryRunRepo.updateDryRun(dryRun.id, {
        status: finalStatus,
        completedAt: new Date(),
        blockerCount,
        summary: `Dry-run completed with ${blockerCount} critical blockers.`
      });

      await this.executionPlanRepo.updateExecutionPlanStatus(
        plan.id, 
        finalStatus === 'PASSED' ? 'DRY_RUN_PASSED' : 'DRY_RUN_BLOCKED'
      );

      await this.auditRepo.recordAuditEvent({
        activationRequestId: plan.activationRequestId,
        actorAdminId: command.adminId,
        action: 'DRY_RUN_COMPLETED',
        safePayload: `Dry run finished with status ${finalStatus}.`
      });

      return completedDryRun;
    } catch (error: any) {
      await this.dryRunRepo.updateDryRun(dryRun.id, {
        status: 'FAILED',
        completedAt: new Date(),
        summary: `Dry-run failed: ${error.message}`
      });
      await this.executionPlanRepo.updateExecutionPlanStatus(plan.id, 'READY_FOR_DRY_RUN'); // allow retry
      throw error;
    }
  }
}
