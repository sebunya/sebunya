import { ControlledActivationDryRunRepository } from '../../ports/activation/ControlledActivationDryRunRepository.js';
import { ControlledActivationExecutionPlanRepository } from '../../ports/activation/ControlledActivationExecutionPlanRepository.js';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository.js';

export interface CancelControlledActivationDryRunCommand {
  adminId: string;
  dryRunId: string;
  reason: string;
}

export class CancelControlledActivationDryRunUseCase {
  constructor(
    private dryRunRepo: ControlledActivationDryRunRepository,
    private executionPlanRepo: ControlledActivationExecutionPlanRepository,
    private auditRepo: ControlledActivationAuditRepository
  ) {}

  async execute(command: CancelControlledActivationDryRunCommand): Promise<void> {
    if (!command.reason || command.reason.trim() === '') {
      throw new Error('Cancellation reason is required.');
    }

    const dryRun = await this.dryRunRepo.getDryRun(command.dryRunId);
    if (!dryRun) throw new Error('Dry run not found.');

    if (dryRun.status === 'RUNNING') {
      await this.dryRunRepo.updateDryRun(dryRun.id, {
        status: 'CANCELLED',
        completedAt: new Date(),
        summary: `Cancelled by admin. Reason: ${command.reason}`
      });

      await this.executionPlanRepo.updateExecutionPlanStatus(dryRun.executionPlanId, 'READY_FOR_DRY_RUN');

      await this.auditRepo.recordAuditEvent({
        activationRequestId: dryRun.activationRequestId,
        actorAdminId: command.adminId,
        action: 'DRY_RUN_CANCELLED',
        safePayload: `Dry run cancelled. Reason: ${command.reason}`
      });
    }
  }
}
