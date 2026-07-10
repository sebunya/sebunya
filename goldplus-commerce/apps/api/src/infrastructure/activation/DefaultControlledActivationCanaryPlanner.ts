import { randomUUID } from 'crypto';
import { ControlledActivationCanaryPlanner, CanaryPlan } from '../../application/ports/activation/ControlledActivationCanaryPlanner.js';

export class DefaultControlledActivationCanaryPlanner implements ControlledActivationCanaryPlanner {
  private plans: Map<string, CanaryPlan> = new Map();

  async validateAndCreateCanaryPlan(executionPlanId: string, scopeSummary: string, percentageCap: number): Promise<{ valid: boolean; plan: CanaryPlan | null; error?: string }> {
    // Basic validation
    if (percentageCap > 20 && scopeSummary.includes('HIGH_RISK')) {
      return {
        valid: false,
        plan: null,
        error: 'Canary plans for high-risk scopes cannot exceed 20% traffic allocation.'
      };
    }

    const plan: CanaryPlan = {
      id: randomUUID(),
      executionPlanId,
      scopeSummary,
      maxAudienceSize: Math.floor(100000 * (percentageCap / 100)), // Dummy calculation
      percentageCap,
      includedSegments: ['CONTROL_GROUP', 'EARLY_ADOPTERS'],
      excludedSegments: ['VIP_CUSTOMERS', 'OPT_OUTS'],
      riskLevel: scopeSummary.includes('HIGH_RISK') ? 'HIGH' : 'LOW',
      createdAt: new Date()
    };

    this.plans.set(executionPlanId, plan);
    return { valid: true, plan };
  }

  async getCanaryPlan(executionPlanId: string): Promise<CanaryPlan | null> {
    return this.plans.get(executionPlanId) || null;
  }
}
