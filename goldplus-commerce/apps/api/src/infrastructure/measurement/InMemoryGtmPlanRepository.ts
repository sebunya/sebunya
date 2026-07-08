import { GtmPlanRepository } from '../../application/ports/measurement/GtmPlanRepository';
import { GtmPlan } from '../../application/ports/measurement/GtmPlanRepository';

export class InMemoryGtmPlanRepository implements GtmPlanRepository {
  private plans: Map<string, GtmPlan> = new Map();

  async createPlan(plan: Omit<GtmPlan, 'planId' | 'createdAt' | 'updatedAt'>): Promise<GtmPlan> {
    const planId = Math.random().toString(36).substring(7);
    const newPlan: GtmPlan = {
      ...plan,
      planId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.plans.set(planId, newPlan);
    return newPlan;
  }

  async getPlan(planId: string): Promise<GtmPlan | null> {
    return this.plans.get(planId) || null;
  }

  async updatePlanStatus(planId: string, status: GtmPlan['status']): Promise<void> {
    const plan = this.plans.get(planId);
    if (plan) {
      plan.status = status;
      plan.updatedAt = new Date();
      this.plans.set(planId, plan);
    }
  }
}
