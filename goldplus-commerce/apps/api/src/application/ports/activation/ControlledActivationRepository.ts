export type ActivationStatus =
  | 'DRAFT'
  | 'READY_FOR_REVIEW'
  | 'APPROVED_FOR_CONTROLLED_ACTIVATION'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'ROLLBACK_REQUIRED'
  | 'COMPLETED_REVIEW_ONLY';

export type ActivationScope =
  | 'GTM_DRAFT_READINESS'
  | 'PAID_SOCIAL_DESTINATION_READINESS'
  | 'PRODUCT_FINDER_MEASUREMENT_READINESS'
  | 'PREFERENCE_AND_CONSENT_READINESS'
  | 'PESAPAL_PURCHASE_MEASUREMENT_READINESS'
  | 'ADMIN_MONITORING_READINESS'
  | 'RELEASE_READINESS_REVIEW'
  | 'FULL_MEASUREMENT_STACK_REVIEW';

export type ActivationEnvironment =
  | 'LOCAL'
  | 'STAGING'
  | 'PRODUCTION_REVIEW'
  | 'PRODUCTION_CONTROLLED_ACTIVATION_PENDING';

export interface ActivationRequest {
  id: string;
  requestedByAdminId: string;
  requestedAt: Date;
  activationName: string;
  activationScope: ActivationScope;
  environment: ActivationEnvironment;
  requestedWindowStart: Date | null;
  requestedWindowEnd: Date | null;
  status: ActivationStatus;
  reason: string;
  canaryScope: string | null;
  rollbackPlanSummary: string | null;
  monitoringOwner: string | null;
  stakeholderApprover: string | null;
  riskLevel: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ControlledActivationRepository {
  createActivationRequest(request: Omit<ActivationRequest, 'createdAt' | 'updatedAt'>): Promise<ActivationRequest>;
  updateActivationRequestStatus(id: string, status: ActivationStatus, reason?: string): Promise<ActivationRequest>;
  getActivationRequest(id: string): Promise<ActivationRequest | null>;
  listActivationRequests(): Promise<ActivationRequest[]>;
  attachRollbackPlanSummary(id: string, plan: string): Promise<void>;
  attachMonitoringPlanSummary(id: string, owner: string): Promise<void>;
}
