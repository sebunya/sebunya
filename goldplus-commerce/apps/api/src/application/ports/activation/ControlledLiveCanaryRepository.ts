export type LiveCanaryStatus =
  | 'DRAFT'
  | 'ELIGIBILITY_CHECK_RUNNING'
  | 'BLOCKED'
  | 'READY_FOR_CANARY'
  | 'CANARY_RUNNING'
  | 'CANARY_PAUSED'
  | 'CANARY_ROLLED_BACK'
  | 'CANARY_COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export interface ControlledLiveCanary {
  id: string;
  dryRunId: string;
  activationRequestId: string;
  status: LiveCanaryStatus;
  canaryCap: number;
  destinationAllowlist: string[];
  rollbackPlan: string;
  monitoringOwner: string;
  rollbackReason?: string | null;
  rollbackOwner?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ControlledLiveCanaryRepository {
  createCanary(canary: Omit<ControlledLiveCanary, 'createdAt' | 'updatedAt'>): Promise<ControlledLiveCanary>;
  updateCanary(id: string, updates: Partial<ControlledLiveCanary>): Promise<ControlledLiveCanary>;
  getCanary(id: string): Promise<ControlledLiveCanary | null>;
  getCanariesForRequest(activationRequestId: string): Promise<ControlledLiveCanary[]>;
}
