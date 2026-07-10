import {
  ActivationExecutionPlan,
  ControlledActivationExecutionPlanRepository
} from '../../ports/activation/ControlledActivationExecutionPlanRepository.js';
import { ControlledActivationRepository } from '../../ports/activation/ControlledActivationRepository.js';
import { ControlledActivationReadinessChecker } from '../../ports/activation/ControlledActivationReadinessChecker.js';
import { randomUUID } from 'crypto';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy.js';
import { ControlledActivationAuditRepository } from '../../ports/activation/ControlledActivationAuditRepository.js';

export interface CreateControlledActivationExecutionPlanCommand {
  adminId: string;
  activationRequestId: string;
  canaryScopeSummary?: string;
  rollbackPlanSummary?: string;
  monitoringOwner?: string;
  requestedWindowStart?: Date;
  requestedWindowEnd?: Date;
}

export class CreateControlledActivationExecutionPlanUseCase {
  constructor(
    private executionPlanRepo: ControlledActivationExecutionPlanRepository,
    private activationRepo: ControlledActivationRepository,
    private readinessChecker: ControlledActivationReadinessChecker,
    private accessPolicy: ControlledActivationAccessPolicy,
    private auditRepo: ControlledActivationAuditRepository
  ) {}

  async execute(command: CreateControlledActivationExecutionPlanCommand): Promise<ActivationExecutionPlan> {
    if (!command.adminId || !command.activationRequestId) {
      throw new Error('Missing required execution plan creation parameters.');
    }

    const hasAccess = await this.accessPolicy.canCreateActivationRequest(command.adminId);
    if (!hasAccess) {
      throw new Error('UNAUTHORIZED');
    }

    const request = await this.activationRepo.getActivationRequest(command.activationRequestId);
    if (!request) {
      throw new Error('Activation request not found.');
    }

    if (request.status !== 'APPROVED_FOR_CONTROLLED_ACTIVATION') {
      throw new Error('Activation request is not approved for controlled activation.');
    }

    const gates = await this.readinessChecker.runChecks(request.id);
    const releaseReadinessGate = gates.find((g: any) => g.gateId === 'RELEASE_READINESS_REVIEW');
    if (!releaseReadinessGate || releaseReadinessGate.status !== 'PASS') {
      throw new Error('Release Readiness PASS gate is required before creating an execution plan.');
    }

    if (!command.rollbackPlanSummary || command.rollbackPlanSummary.trim() === '') {
      throw new Error('Rollback plan is required.');
    }
    if (!command.monitoringOwner || command.monitoringOwner.trim() === '') {
      throw new Error('Monitoring owner is required.');
    }
    if (!command.requestedWindowStart || !command.requestedWindowEnd) {
      throw new Error('Activation window is required.');
    }
    if (!command.canaryScopeSummary || command.canaryScopeSummary.trim() === '') {
      throw new Error('Canary scope is required.');
    }

    const plan = await this.executionPlanRepo.createExecutionPlan({
      id: randomUUID(),
      activationRequestId: command.activationRequestId,
      createdByAdminId: command.adminId,
      status: 'READY_FOR_DRY_RUN',
      activationScope: request.activationScope,
      environment: request.environment,
      requestedWindowStart: command.requestedWindowStart || request.requestedWindowStart,
      requestedWindowEnd: command.requestedWindowEnd || request.requestedWindowEnd,
      canaryScopeSummary: command.canaryScopeSummary || null,
      rollbackPlanSummary: command.rollbackPlanSummary || request.rollbackPlanSummary,
      monitoringOwner: command.monitoringOwner || request.monitoringOwner
    });

    await this.auditRepo.recordAuditEvent({
      activationRequestId: command.activationRequestId,
      actorAdminId: command.adminId,
      action: 'EXECUTION_PLAN_CREATED',
      safePayload: `Plan ${plan.id} created for ${request.activationScope}`
    });

    return plan;
  }
}
