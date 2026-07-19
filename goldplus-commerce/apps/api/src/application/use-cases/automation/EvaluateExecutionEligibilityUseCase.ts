import {
  AutomationEligibilityGateInput,
  AutomationFrequencyConfig,
  AutomationSuppressionReason,
  evaluateAutomationEligibility,
} from '../../../domain/automation/Automation';
import { IAutomationEligibilityRepository } from '../../ports/IAutomationEligibilityRepository';

export type AutomationExecutionMode = 'LIVE' | 'ATOMIC_EXTERNAL' | 'DRY_RUN' | 'DISABLED' | 'NOT_CONFIGURED' | 'SUPPRESSED';

export interface EvaluateExecutionEligibilityInput extends AutomationEligibilityGateInput {
  executionId: string;
  definitionId: string;
  versionId: string;
  windowKey: string;
  frequency: AutomationFrequencyConfig | null;
  mode: AutomationExecutionMode;
  modeSuppressionReason: AutomationSuppressionReason | null;
}

export type ExecutionEligibilityResult =
  | { eligible: false; suppressionReason: AutomationSuppressionReason; capReserved: false; capReused: false }
  | { eligible: true; suppressionReason: null; capReserved: boolean; capReused: boolean };

/** Applies pure non-provider gates, then reserves a durable cap slot if LIVE. */
export class EvaluateExecutionEligibilityUseCase {
  constructor(private readonly eligibility: IAutomationEligibilityRepository) {}

  async execute(input: EvaluateExecutionEligibilityInput): Promise<ExecutionEligibilityResult> {
    const gate = evaluateAutomationEligibility(input);
    if (!gate.eligible) {
      await this.eligibility.recordSuppression({
        executionId: input.executionId,
        subjectId: input.subjectId,
        reason: gate.suppressionReason,
      });
      return { eligible: false, suppressionReason: gate.suppressionReason, capReserved: false, capReused: false };
    }

    if (input.mode === 'SUPPRESSED') {
      if (!input.modeSuppressionReason) throw new Error('AUTOMATION_SUPPRESSION_REASON_REQUIRED');
      await this.eligibility.recordSuppression({
        executionId: input.executionId,
        subjectId: input.subjectId,
        reason: input.modeSuppressionReason,
      });
      return { eligible: false, suppressionReason: input.modeSuppressionReason, capReserved: false, capReused: false };
    }

    // Non-live operational outcomes are truthful but never consume a slot.
    if (input.mode !== 'LIVE' || !input.frequency || input.frequency.perCustomerPerWindow === null) {
      return { eligible: true, suppressionReason: null, capReserved: false, capReused: false };
    }

    const reserved = await this.eligibility.reserveFrequencyCap({
      executionId: input.executionId,
      definitionId: input.definitionId,
      versionId: input.versionId,
      subjectId: input.subjectId!,
      windowKey: input.windowKey,
      limit: input.frequency.perCustomerPerWindow,
      global: input.frequency.global,
    });
    if (!reserved.reserved) {
      return { eligible: false, suppressionReason: reserved.reason, capReserved: false, capReused: false };
    }
    return { eligible: true, suppressionReason: null, capReserved: true, capReused: reserved.reused };
  }
}
