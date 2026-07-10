export type ExecutionPlanStatus =
  | 'READY_FOR_DRY_RUN'
  | 'DRY_RUN_RUNNING'
  | 'DRY_RUN_PASSED'
  | 'DRY_RUN_BLOCKED'
  | 'CANCELLED'
  | 'READY_FOR_LIVE_REVIEW';

export interface ActivationExecutionPlan {
  id: string;
  activationRequestId: string;
  createdByAdminId: string;
  status: ExecutionPlanStatus;
  activationScope: string;
  environment: string;
  requestedWindowStart: Date | null;
  requestedWindowEnd: Date | null;
  canaryScopeSummary: string | null;
  rollbackPlanSummary: string | null;
  monitoringOwner: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ControlledActivationExecutionPlanRepository {
  createExecutionPlan(plan: Omit<ActivationExecutionPlan, 'createdAt' | 'updatedAt'>): Promise<ActivationExecutionPlan>;
  updateExecutionPlanStatus(id: string, status: ExecutionPlanStatus): Promise<ActivationExecutionPlan>;
  getExecutionPlan(id: string): Promise<ActivationExecutionPlan | null>;
  getExecutionPlanForRequest(activationRequestId: string): Promise<ActivationExecutionPlan | null>;
}
