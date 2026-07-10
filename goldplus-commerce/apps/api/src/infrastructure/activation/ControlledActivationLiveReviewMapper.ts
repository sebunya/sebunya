import { LiveReviewCandidate, LiveReadinessCheck, LiveReviewCandidateStatus, LiveReadinessStatus } from '../../application/ports/activation/ControlledActivationLiveReviewRepository';

export class ControlledActivationLiveReviewMapper {
  static toCandidateDomain(raw: any): LiveReviewCandidate {
    return {
      id: raw.id,
      activationRequestId: raw.activationRequestId,
      executionPlanId: raw.executionPlanId,
      dryRunId: raw.dryRunId,
      evidencePackId: raw.evidencePackId,
      createdByAdminId: raw.createdByAdminId,
      status: raw.status as LiveReviewCandidateStatus,
      environment: raw.environment,
      activationWindowStart: raw.activationWindowStart,
      activationWindowEnd: raw.activationWindowEnd,
      canaryScopeSummary: raw.canaryScopeSummary,
      monitoringOwner: raw.monitoringOwner,
      incidentOwner: raw.incidentOwner,
      rollbackOwner: raw.rollbackOwner,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  static toReadinessCheckDomain(raw: any): LiveReadinessCheck {
    return {
      id: raw.id,
      candidateId: raw.candidateId,
      gateId: raw.gateId,
      status: raw.status as LiveReadinessStatus,
      severity: raw.severity,
      evidenceSummary: raw.evidenceSummary,
      blockerReason: raw.blockerReason || undefined,
      checkedAt: raw.checkedAt,
    };
  }
}
