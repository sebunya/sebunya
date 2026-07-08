export interface GtmPlan {
  planId: string;
  status: 'DRAFT' | 'VALIDATED' | 'APPLIED' | 'FAILED';
  changes: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface GtmPlanRepository {
  createPlan(plan: Omit<GtmPlan, 'planId' | 'createdAt' | 'updatedAt'>): Promise<GtmPlan>;
  getPlan(planId: string): Promise<GtmPlan | null>;
  updatePlanStatus(planId: string, status: GtmPlan['status']): Promise<void>;
}
