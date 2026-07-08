import { GtmPlanRepository } from '../../ports/measurement/GtmPlanRepository';
import { GtmRepository } from '../../ports/measurement/GtmRepository';
import { GtmPlanBuilder } from '../../services/measurement/GtmPlanBuilder';

export class PlanGtmMeasurementChangesUseCase {
  constructor(
    private readonly gtmRepo: GtmRepository,
    private readonly planRepo: GtmPlanRepository,
    private readonly planBuilder: GtmPlanBuilder
  ) {}

  async execute(containerType: 'web' | 'server') {
    const status = await this.gtmRepo.getCredentialStatus();
    const plan = this.planBuilder.buildGoldPlusPlan(containerType);
    
    if (!status.configured) {
      return { status: 'NOT_CONFIGURED', data: plan, error: 'Missing credentials' };
    }

    const planId = `plan_${Date.now()}`;
    await this.planRepo.savePlan(planId, plan);

    return { status: 'DRY_RUN_PLAN_CREATED', data: plan, planId };
  }
}
