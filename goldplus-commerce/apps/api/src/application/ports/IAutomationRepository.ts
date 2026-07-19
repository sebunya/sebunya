import { AutomationVersionConfig, TriggerFamily } from '../../domain/automation/Automation';

export interface ActiveAutomation {
  definitionId: string;
  versionId: string;
  versionNumber: number;
  config: AutomationVersionConfig;
  requiresApproval: boolean;
  approvalValid: boolean;
}

export interface IAutomationRepository {
  /** Active + APPROVED immutable versions whose trigger matches (family + optional ref). */
  findActiveApprovedByTrigger(triggerFamily: TriggerFamily, triggerRef: string | null, now: Date): Promise<ActiveAutomation[]>;
  isDefinitionPaused(definitionId: string): Promise<boolean>;
}

export interface PlannedActionInput { actionIndex: number; actionFamily: string; idempotencyKey: string; }

export interface AutomationPlanInput {
  definitionId: string;
  versionId: string;
  versionNumber: number;
  triggerExecutionKey: string;
  triggerFamily: TriggerFamily;
  triggerEventId: string | null;
  subjectId: string | null;
  windowKey: string;
  status: 'ELIGIBLE' | 'INELIGIBLE';
  evidence: unknown;
  plannedActions: PlannedActionInput[];
  expiresAt: Date | null;
}

export type PlanPersistResult = { created: boolean; executionId: string };

export interface IAutomationExecutionRepository {
  /** Idempotent on trigger_execution_key: a duplicate trigger yields the existing plan. */
  persistPlan(input: AutomationPlanInput): Promise<PlanPersistResult>;
  findByTriggerKey(triggerExecutionKey: string): Promise<{ id: string; status: string } | null>;
  countActionsForExecution(executionId: string): Promise<number>;
}

export type AudienceOutcome = 'ELIGIBLE' | 'INELIGIBLE' | 'NO_PROFILE' | 'NO_CONSENT' | 'STALE_PROFILE' | 'IDENTITY_CONFLICT' | 'NO_DATA';

export interface AudienceResolution {
  outcome: AudienceOutcome;
  subjectId: string;
  lifecycleStage: string | null;
  consentEligible: boolean | null;
  identityConfidence: string | null;
  computedAt: Date | null;
}

/** Resolves a subject's audience membership from real first-party data (Customer DNA etc.). */
export interface IAutomationAudienceReader {
  resolveSubject(subjectId: string, now: Date): Promise<AudienceResolution>;
}
