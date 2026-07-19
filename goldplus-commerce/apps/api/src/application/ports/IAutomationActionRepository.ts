import { AutomationActionConfig, AutomationVersionConfig, ExecutionStatus } from '../../domain/automation/Automation';
import { AutomationFrequencyCapRequest } from './IAutomationEligibilityRepository';

export interface AutomationExternalIntentInput {
  executionId: string;
  actionExecutionId: string;
  action: AutomationActionConfig;
  idempotencyKey: string;
  cap: AutomationFrequencyCapRequest | null;
}

export type AutomationExternalIntentResult =
  | { outcome: 'QUEUED'; outboxEventId: string; capReused: boolean }
  | { outcome: 'DUPLICATE'; outboxEventId: string | null; capReused: boolean }
  | { outcome: 'SUPPRESSED'; outboxEventId: null; capReused: false; reason: 'FREQUENCY_CAPPED' };

export interface IAutomationActionRepository {
  queueExternalIntent(input: AutomationExternalIntentInput): Promise<AutomationExternalIntentResult>;
  claimInternal(input: {
    actionExecutionId: string;
    expectedFamily: string;
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<'CLAIMED' | 'COMPLETED' | 'BUSY'>;
  completeInternal(actionExecutionId: string): Promise<void>;
  markTerminal(actionExecutionId: string, status: 'NOT_CONFIGURED' | 'SUPPRESSED'): Promise<void>;
  claimProviderAttempt(input: {
    actionExecutionId: string;
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<AutomationProviderAttemptClaim>;
  recordProviderOutcome(input: {
    actionExecutionId: string;
    status: 'SENT' | 'FAILED' | 'OUTCOME_UNKNOWN' | 'DRY_RUN' | 'NOT_CONFIGURED' | 'DISABLED';
    attempted: boolean;
    providerCode: string | null;
    providerMessage: string;
  }): Promise<{ status: ExecutionStatus; attemptCount: number }>;
  findReplayCandidate(actionExecutionId: string, now: Date): Promise<AutomationReplayCandidate | null>;
  markReplayed(actionExecutionId: string, actorId: string, reason: string, now: Date): Promise<boolean>;
  reconcileUnknown(input: {
    actionExecutionId: string;
    resolution: 'SENT' | 'FAILED';
    actorId: string;
    reason: string;
    evidence: string;
    correlationId?: string;
    now: Date;
  }): Promise<boolean>;
}

export type AutomationProviderAttemptClaim =
  | { outcome: 'CLAIMED'; attemptCount: number }
  | { outcome: 'BUSY'; attemptCount: number }
  | { outcome: 'TERMINAL'; status: ExecutionStatus; attemptCount: number };

export interface AutomationReplayCandidate {
  actionExecutionId: string;
  executionId: string;
  outboxEventId: string | null;
  definitionId: string;
  versionId: string;
  versionNumber: number;
  definitionPaused: boolean;
  requiresApproval: boolean;
  approvalValid: boolean;
  subjectId: string | null;
  windowKey: string;
  status: ExecutionStatus;
  action: AutomationActionConfig;
  config: AutomationVersionConfig;
}

export interface AutomationInternalActionExecutionResult {
  effectId: string | null;
  idempotentReplay: boolean;
}

export interface IAutomationInternalActionExecutor {
  isConfigured(action: AutomationActionConfig): Promise<boolean>;
  execute(action: AutomationActionConfig): Promise<AutomationInternalActionExecutionResult>;
}
