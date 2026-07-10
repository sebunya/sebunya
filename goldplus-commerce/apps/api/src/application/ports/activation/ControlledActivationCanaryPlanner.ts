export interface CanaryPlan {
  id: string;
  executionPlanId: string;
  scopeSummary: string;
  maxAudienceSize: number;
  percentageCap: number;
  includedSegments: string[];
  excludedSegments: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  createdAt: Date;
}

export interface ControlledActivationCanaryPlanner {
  validateAndCreateCanaryPlan(
    executionPlanId: string,
    scopeSummary: string,
    percentageCap: number
  ): Promise<{ valid: boolean; plan: CanaryPlan | null; error?: string }>;
  getCanaryPlan(executionPlanId: string): Promise<CanaryPlan | null>;
}
