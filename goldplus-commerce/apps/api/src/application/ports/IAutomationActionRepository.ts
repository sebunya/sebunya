import { AutomationActionConfig } from '../../domain/automation/Automation';
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
}

export interface AutomationInternalActionExecutionResult {
  effectId: string | null;
  idempotentReplay: boolean;
}

export interface IAutomationInternalActionExecutor {
  isConfigured(action: AutomationActionConfig): Promise<boolean>;
  execute(action: AutomationActionConfig): Promise<AutomationInternalActionExecutionResult>;
}
