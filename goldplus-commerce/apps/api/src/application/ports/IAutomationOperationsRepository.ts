import { AutomationVersionConfig, DefinitionStatus, ExecutionStatus } from '../../domain/automation/Automation';

export type AutomationOperationErrorCode =
  | 'AUTOMATION_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_EXPIRED'
  | 'STALE_VERSION'
  | 'REPLAY_NOT_ALLOWED'
  | 'RECONCILIATION_NOT_ALLOWED'
  | 'RECONCILIATION_EVIDENCE_REQUIRED'
  | 'OUTCOME_NOT_AMBIGUOUS';

export class AutomationOperationError extends Error {
  constructor(public readonly code: AutomationOperationErrorCode, message: string) {
    super(message);
    this.name = 'AutomationOperationError';
  }
}

export interface AutomationOverview {
  activeAutomations: number;
  pausedAutomations: number;
  pendingApprovals: number;
  executions: Record<ExecutionStatus, number>;
  suppressionsByReason: Record<string, number>;
  oldestQueuedAgeSeconds: number | null;
  averagePlanningDurationMs: number | null;
  averageExecutionDurationMs: number | null;
  nextScheduledRun: string | null;
  providerReadiness: { queuedIntents: number; attempted: number; succeeded: number; ambiguous: number };
}

export interface AutomationDefinitionSummary {
  id: string;
  name: string;
  description: string | null;
  status: DefinitionStatus;
  currentVersion: number;
  approvalStatus: string | null;
  approvalExpiresAt: string | null;
  requiresApproval: boolean | null;
  nextRunAt: string | null;
  updatedAt: string;
}

export interface AutomationVersionView {
  id: string;
  versionNumber: number;
  config: AutomationVersionConfig;
  requiresApproval: boolean;
  createdBy: string | null;
  createdAt: string;
  approval: { status: string; approverId: string | null; expiresAt: string | null; reason: string | null } | null;
}

export interface AutomationDefinitionDetail extends AutomationDefinitionSummary {
  versions: AutomationVersionView[];
  events: AutomationTimelineEvent[];
}

export interface AutomationTimelineEvent {
  id: string;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  actorId: string | null;
  reason: string | null;
  correlationId: string | null;
  createdAt: string;
}

export interface AutomationExecutionSummary {
  id: string;
  definitionId: string;
  definitionName: string;
  versionId: string;
  versionNumber: number;
  triggerFamily: string;
  subjectId: string | null;
  windowKey: string;
  status: string;
  plannedAt: string;
  updatedAt: string;
}

export interface AutomationActionView {
  id: string;
  actionIndex: number;
  actionFamily: string;
  status: string;
  attemptCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
  outboxEventId: string | null;
  outboxStatus: string | null;
  outboxProcessedAt: string | null;
  deadLetteredAt: string | null;
  replayedAt: string | null;
  replayActor: string | null;
  sentAt: string | null;
}

export interface AutomationExecutionDetail extends AutomationExecutionSummary {
  evidence: unknown;
  actions: AutomationActionView[];
  suppressions: Array<{ reason: string; createdAt: string }>;
  frequencyReservation: { windowKey: string; limitSnapshot: number; createdAt: string } | null;
  events: AutomationTimelineEvent[];
}

export interface OperationalAutomationVersion {
  definitionId: string;
  definitionStatus: DefinitionStatus;
  versionId: string;
  versionNumber: number;
  requiresApproval: boolean;
  approvalValid: boolean;
  config: AutomationVersionConfig;
}

export interface IAutomationOperationsRepository {
  getOverview(now: Date): Promise<AutomationOverview>;
  listDefinitions(input: { status?: string; limit: number; offset: number }): Promise<{ items: AutomationDefinitionSummary[]; total: number }>;
  getDefinition(id: string): Promise<AutomationDefinitionDetail | null>;
  createDefinition(input: { name: string; description: string | null; actorId: string; now: Date }): Promise<AutomationDefinitionSummary>;
  createVersion(input: { definitionId: string; expectedVersion: number; config: AutomationVersionConfig; requiresApproval: boolean; actorId: string; now: Date }): Promise<AutomationVersionView>;
  submit(input: { definitionId: string; expectedVersion: number; actorId: string; expiresAt: Date | null; now: Date }): Promise<void>;
  decide(input: { definitionId: string; versionId: string; expectedVersion: number; decision: 'APPROVED' | 'REJECTED'; actorId: string; reason: string | null; expiresAt: Date | null; now: Date }): Promise<void>;
  transition(input: { definitionId: string; expectedVersion: number; to: 'ACTIVE' | 'PAUSED' | 'ARCHIVED'; actorId: string; reason: string | null; now: Date }): Promise<void>;
  loadOperationalVersion(definitionId: string, now: Date): Promise<OperationalAutomationVersion | null>;
  persistControlledExecution(input: { definition: OperationalAutomationVersion; triggerEventId: string; subjectId: string | null; windowKey: string; status: 'DRY_RUN' | 'ELIGIBLE' | 'INELIGIBLE'; evidence: unknown; actorId: string; now: Date }): Promise<{ executionId: string; actionExecutionIds: string[]; duplicate: boolean }>;
  listExecutions(input: { status?: string; definitionId?: string; limit: number; offset: number }): Promise<{ items: AutomationExecutionSummary[]; total: number }>;
  getExecution(id: string): Promise<AutomationExecutionDetail | null>;
}
