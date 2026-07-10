import { ControlledActivationCanaryPlanner, CanaryPlan } from '../../ports/activation/ControlledActivationCanaryPlanner.js';

export interface ValidateControlledActivationCanaryPlanCommand {
  executionPlanId: string;
  scopeSummary: string;
  percentageCap: number;
}

export class ValidateControlledActivationCanaryPlanUseCase {
  constructor(private canaryPlanner: ControlledActivationCanaryPlanner) {}

  async execute(command: ValidateControlledActivationCanaryPlanCommand): Promise<{ valid: boolean; plan: CanaryPlan | null; error?: string }> {
    if (!command.scopeSummary || command.scopeSummary.trim() === '') {
      return { valid: false, plan: null, error: 'Scope summary is required.' };
    }
    if (command.percentageCap === undefined || command.percentageCap <= 0) {
      return { valid: false, plan: null, error: 'Percentage cap must be greater than 0.' };
    }
    if (command.percentageCap >= 100 && command.scopeSummary.includes('ALL')) {
      return { valid: false, plan: null, error: 'BLOCKED: Unrestricted full-production scope is forbidden for canary plans.' };
    }

    return this.canaryPlanner.validateAndCreateCanaryPlan(
      command.executionPlanId,
      command.scopeSummary,
      command.percentageCap
    );
  }
}
