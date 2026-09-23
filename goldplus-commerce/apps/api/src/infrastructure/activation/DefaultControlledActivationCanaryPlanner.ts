import { randomUUID } from 'crypto';
import { ControlledActivationCanaryPlanner, CanaryPlan } from '../../application/ports/activation/ControlledActivationCanaryPlanner.js';

/**
 * KNOWN LIMITATION (2026-09-23): plans live in THIS process's memory. Production
 * runs two API containers and restarts on every deploy, so a plan validated on one
 * container is missing on the other and gone after a restart — readiness checks and
 * runbooks then fail with "Canary plan is missing". The fix is a table (migration)
 * and a Drizzle repository behind this same port; deferred with the rest of the
 * controlled-activation clients (trigger: the first measurement destination goes
 * live). The segment names and the 100,000-audience base below are placeholders,
 * not measured facts — replace them with real audience data when this is built.
 * Within one process there is exactly ONE instance (the Registry's; a route used to
 * build its own, which made every plan invisible to live review).
 */
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
