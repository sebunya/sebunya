import { ControlledActivationRepository } from '../../ports/activation/ControlledActivationRepository.js';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository.js';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy.js';
import { ControlledActivationReadinessChecker, ActivationGate } from '../../ports/activation/ControlledActivationReadinessChecker.js';

export interface RunReadinessChecksCommand {
  adminId: string;
  activationRequestId: string;
}

export class RunControlledActivationReadinessChecksUseCase {
  constructor(
    private readonly repository: ControlledActivationRepository,
    private readonly auditRepo: ControlledActivationAuditRepository,
    private readonly accessPolicy: ControlledActivationAccessPolicy,
    private readonly checker: ControlledActivationReadinessChecker
  ) {}

  async execute(command: RunReadinessChecksCommand): Promise<ActivationGate[]> {
    const canRun = await this.accessPolicy.canRunActivationReadinessChecks(command.adminId);
    if (!canRun) {
      throw new Error('Forbidden: Cannot run activation readiness checks');
    }

    const request = await this.repository.getActivationRequest(command.activationRequestId);
    if (!request) {
      throw new Error('Activation request not found');
    }

    const gates = await this.checker.runChecks(command.activationRequestId);
    
    await this.checker.saveGates(gates);

    await this.auditRepo.recordAuditEvent({
      activationRequestId: request.id,
      actorAdminId: command.adminId,
      action: 'RAN_READINESS_CHECKS',
      safePayload: JSON.stringify({ gatesCount: gates.length })
    });

    if (request.status === 'DRAFT') {
      await this.repository.updateActivationRequestStatus(request.id, 'READY_FOR_REVIEW', 'Readiness checks completed');
    }

    return gates;
  }
}
