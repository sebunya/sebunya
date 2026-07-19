import { AutomationActionConfig, AutomationEligibilityGateInput, AutomationFrequencyConfig } from '../../../domain/automation/Automation';
import { IAutomationActionRepository, IAutomationInternalActionExecutor } from '../../ports/IAutomationActionRepository';
import { EvaluateExecutionEligibilityUseCase } from './EvaluateExecutionEligibilityUseCase';

export interface ExecuteAutomationActionInput extends AutomationEligibilityGateInput {
  executionId: string;
  actionExecutionId: string;
  definitionId: string;
  versionId: string;
  windowKey: string;
  idempotencyKey: string;
  frequency: AutomationFrequencyConfig | null;
  action: AutomationActionConfig;
  workerId: string;
  now?: Date;
}

export type ExecuteAutomationActionResult =
  | { outcome: 'INTERNAL_SUCCESS'; duplicate: boolean; providerCalls: 0 }
  | { outcome: 'IN_PROGRESS'; duplicate: true; providerCalls: 0 }
  | { outcome: 'QUEUED'; duplicate: boolean; outboxEventId: string | null; providerCalls: 0 }
  | { outcome: 'SUPPRESSED'; duplicate: false; reason: string; providerCalls: 0 }
  | { outcome: 'NOT_CONFIGURED'; duplicate: false; providerCalls: 0 };

const EXTERNAL_ACTIONS = new Set(['EMAIL', 'WHATSAPP_TEMPLATE']);
const INTERNAL_LEASE_MS = 5 * 60_000;

/** Executes internal effects or persists an external intent. Never calls a provider. */
export class ExecuteAutomationActionUseCase {
  constructor(
    private readonly eligibility: EvaluateExecutionEligibilityUseCase,
    private readonly actions: IAutomationActionRepository,
    private readonly internal: IAutomationInternalActionExecutor
  ) {}

  async execute(input: ExecuteAutomationActionInput): Promise<ExecuteAutomationActionResult> {
    const external = EXTERNAL_ACTIONS.has(input.action.family);
    const internalConfigured = external || input.action.family === 'NO_ACTION'
      ? true
      : await this.internal.isConfigured(input.action);
    const mode = external ? 'ATOMIC_EXTERNAL' : internalConfigured ? 'LIVE' : 'NOT_CONFIGURED';
    const gate = await this.eligibility.execute({
      ...input,
      mode,
      modeSuppressionReason: null,
    });
    if (!gate.eligible) {
      await this.actions.markTerminal(input.actionExecutionId, 'SUPPRESSED');
      return { outcome: 'SUPPRESSED', duplicate: false, reason: gate.suppressionReason, providerCalls: 0 };
    }

    if (!internalConfigured) {
      await this.actions.markTerminal(input.actionExecutionId, 'NOT_CONFIGURED');
      return { outcome: 'NOT_CONFIGURED', duplicate: false, providerCalls: 0 };
    }

    if (external) {
      const cap = input.frequency?.perCustomerPerWindow === null || !input.frequency
        ? null
        : {
            executionId: input.executionId,
            definitionId: input.definitionId,
            versionId: input.versionId,
            subjectId: input.subjectId!,
            windowKey: input.windowKey,
            limit: input.frequency.perCustomerPerWindow,
            global: input.frequency.global,
          };
      const queued = await this.actions.queueExternalIntent({
        executionId: input.executionId,
        actionExecutionId: input.actionExecutionId,
        action: input.action,
        idempotencyKey: input.idempotencyKey,
        cap,
      });
      if (queued.outcome === 'SUPPRESSED') {
        return { outcome: 'SUPPRESSED', duplicate: false, reason: queued.reason, providerCalls: 0 };
      }
      return {
        outcome: 'QUEUED',
        duplicate: queued.outcome === 'DUPLICATE',
        outboxEventId: queued.outboxEventId,
        providerCalls: 0,
      };
    }

    const claim = await this.actions.claimInternal({
      actionExecutionId: input.actionExecutionId,
      expectedFamily: input.action.family,
      workerId: input.workerId,
      now: input.now ?? new Date(),
      leaseMs: INTERNAL_LEASE_MS,
    });
    if (claim === 'COMPLETED') return { outcome: 'INTERNAL_SUCCESS', duplicate: true, providerCalls: 0 };
    if (claim === 'BUSY') return { outcome: 'IN_PROGRESS', duplicate: true, providerCalls: 0 };
    if (input.action.family !== 'NO_ACTION') await this.internal.execute(input.action);
    await this.actions.completeInternal(input.actionExecutionId);
    return { outcome: 'INTERNAL_SUCCESS', duplicate: false, providerCalls: 0 };
  }
}
