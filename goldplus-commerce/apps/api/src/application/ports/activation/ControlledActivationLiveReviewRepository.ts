export type LiveReviewCandidateStatus = 
  | 'DRAFT'
  | 'READY_FOR_REVIEW'
  | 'BLOCKED'
  | 'APPROVED_FOR_FUTURE_CONTROLLED_ACTIVATION'
  | 'CANCELLED'
  | 'EXPIRED';

export interface LiveReviewCandidate {
  id: string;
  activationRequestId: string;
  executionPlanId: string;
  dryRunId: string;
  evidencePackId: string;
  createdByAdminId: string;
  status: LiveReviewCandidateStatus;
  environment: string;
  activationWindowStart: Date;
  activationWindowEnd: Date;
  canaryScopeSummary: string;
  monitoringOwner: string;
  incidentOwner: string;
  rollbackOwner: string;
  createdAt: Date;
  updatedAt: Date;
}

export type LiveReadinessStatus =
  | 'PASS'
  | 'WARN'
  | 'BLOCKED'
  | 'NOT_CONFIGURED'
  | 'CONSENT_BLOCKED'
  | 'DRY_RUN_ONLY'
  | 'EXPIRED'
  | 'UNKNOWN';

export interface LiveReadinessCheck {
  id: string;
  candidateId: string;
  gateId: string;
  status: LiveReadinessStatus;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  evidenceSummary: string;
  blockerReason?: string;
  checkedAt: Date;
}

export interface ControlledActivationLiveReviewRepository {
  createCandidate(candidate: LiveReviewCandidate): Promise<void>;
  updateCandidateStatus(candidateId: string, status: LiveReviewCandidateStatus): Promise<void>;
  getCandidateById(candidateId: string): Promise<LiveReviewCandidate | null>;
  listCandidates(): Promise<LiveReviewCandidate[]>;
  saveReadinessChecks(checks: LiveReadinessCheck[]): Promise<void>;
  getReadinessChecksByCandidateId(candidateId: string): Promise<LiveReadinessCheck[]>;
}
