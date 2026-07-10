import { ActivationExecutionPlan, ExecutionPlanStatus } from '../../application/ports/activation/ControlledActivationExecutionPlanRepository.js';
import { ActivationDryRun, ActivationDryRunStatus } from '../../application/ports/activation/ControlledActivationDryRunRepository.js';

export class ControlledActivationDryRunMapper {
  static toExecutionPlanDomain(row: any): ActivationExecutionPlan {
    return {
      id: row.id,
      activationRequestId: row.activationRequestId,
      createdByAdminId: row.createdByAdminId,
      status: row.status as ExecutionPlanStatus,
      activationScope: row.activationScope,
      environment: row.environment,
      requestedWindowStart: row.requestedWindowStart ? new Date(row.requestedWindowStart) : null,
      requestedWindowEnd: row.requestedWindowEnd ? new Date(row.requestedWindowEnd) : null,
      canaryScopeSummary: row.canaryScopeSummary,
      rollbackPlanSummary: row.rollbackPlanSummary,
      monitoringOwner: row.monitoringOwner,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt)
    };
  }

  static toDryRunDomain(row: any): ActivationDryRun {
    return {
      id: row.id,
      executionPlanId: row.executionPlanId,
      activationRequestId: row.activationRequestId,
      startedByAdminId: row.startedByAdminId,
      status: row.status as ActivationDryRunStatus,
      startedAt: new Date(row.startedAt),
      completedAt: row.completedAt ? new Date(row.completedAt) : null,
      summary: row.summary,
      blockerCount: row.blockerCount,
      warningCount: row.warningCount,
      redactedEvidenceRef: row.redactedEvidenceRef
    };
  }
}
