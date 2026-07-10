import { ControlledActivationRepository, ActivationRequest, ActivationScope, ActivationEnvironment } from '../../ports/activation/ControlledActivationRepository.js';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository.js';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy.js';

export interface CreateControlledActivationRequestCommand {
  adminId: string;
  activationName: string;
  activationScope: ActivationScope;
  environment: ActivationEnvironment;
  requestedWindowStart?: Date;
  requestedWindowEnd?: Date;
  reason: string;
  canaryScope?: string;
  rollbackPlanSummary: string;
  monitoringOwner: string;
  riskLevel?: string;
}

export class CreateControlledActivationRequestUseCase {
  constructor(
    private readonly repository: ControlledActivationRepository,
    private readonly auditRepo: ControlledActivationAuditRepository,
    private readonly accessPolicy: ControlledActivationAccessPolicy
  ) {}

  async execute(command: CreateControlledActivationRequestCommand): Promise<ActivationRequest> {
    const canCreate = await this.accessPolicy.canCreateActivationRequest(command.adminId);
    if (!canCreate) {
      throw new Error('Forbidden: Cannot create activation request');
    }

    if (!command.reason) {
      throw new Error('Reason is required for controlled activation');
    }

    if (!command.rollbackPlanSummary) {
      throw new Error('Rollback plan summary is required to ensure safety');
    }

    if (!command.monitoringOwner) {
      throw new Error('Monitoring owner must be assigned before activation');
    }

    const request = await this.repository.createActivationRequest({
      id: crypto.randomUUID(),
      requestedByAdminId: command.adminId,
      requestedAt: new Date(),
      activationName: command.activationName,
      activationScope: command.activationScope,
      environment: command.environment,
      requestedWindowStart: command.requestedWindowStart || null,
      requestedWindowEnd: command.requestedWindowEnd || null,
      status: 'DRAFT',
      reason: command.reason,
      canaryScope: command.canaryScope || null,
      rollbackPlanSummary: command.rollbackPlanSummary,
      monitoringOwner: command.monitoringOwner,
      stakeholderApprover: null,
      riskLevel: command.riskLevel || 'MEDIUM',
    });

    await this.auditRepo.recordAuditEvent({
      activationRequestId: request.id,
      actorAdminId: command.adminId,
      action: 'CREATED_REQUEST',
      safePayload: JSON.stringify({ scope: request.activationScope, status: request.status })
    });

    return request;
  }
}
