export type ActivationDryRunStatus =
  | 'RUNNING'
  | 'PASSED'
  | 'BLOCKED'
  | 'FAILED'
  | 'CANCELLED';

export interface ActivationDryRun {
  id: string;
  executionPlanId: string;
  activationRequestId: string;
  startedByAdminId: string;
  status: ActivationDryRunStatus;
  startedAt: Date;
  completedAt: Date | null;
  summary: string | null;
  blockerCount: number;
  warningCount: number;
  redactedEvidenceRef: string | null;
}

export interface ControlledActivationDryRunRepository {
  createDryRun(dryRun: Omit<ActivationDryRun, 'startedAt'>): Promise<ActivationDryRun>;
  updateDryRun(id: string, updates: Partial<ActivationDryRun>): Promise<ActivationDryRun>;
  getDryRun(id: string): Promise<ActivationDryRun | null>;
  getDryRunsForPlan(executionPlanId: string): Promise<ActivationDryRun[]>;
}
