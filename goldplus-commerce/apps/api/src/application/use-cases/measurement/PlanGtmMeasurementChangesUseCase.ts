import { GtmPlanRepository } from '../../ports/measurement/GtmPlanRepository';

export class PlanGtmMeasurementChangesUseCase {
  constructor(private readonly gtmPlanRepository: GtmPlanRepository) {}

  async execute(changes: any) {
    const plan = await this.gtmPlanRepository.createPlan({
      status: 'DRAFT',
      changes,
    });
    return plan;
  }
}
