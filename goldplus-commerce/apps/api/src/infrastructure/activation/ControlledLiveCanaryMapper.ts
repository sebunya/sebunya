import { ControlledLiveCanary } from '../../application/ports/activation/ControlledLiveCanaryRepository.js';


export class ControlledLiveCanaryMapper {
  static toDomain(row: any): ControlledLiveCanary {
    return {
      id: row.id,
      dryRunId: row.dryRunId,
      activationRequestId: row.activationRequestId,
      status: row.status as any,
      canaryCap: row.canaryCap,
      destinationAllowlist: row.destinationAllowlist,
      rollbackPlan: row.rollbackPlan,
      monitoringOwner: row.monitoringOwner,
      rollbackReason: row.rollbackReason,
      rollbackOwner: row.rollbackOwner,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
