export interface ControlledActivationIncidentPlan {
  id: string;
  candidateId: string;
  incidentOwner: string;
  escalationPath: string;
  rollbackOwner: string;
  pauseCriteria: string;
  rollbackCriteria: string;
  communicationPlan: string;
  createdAt: Date;
}

export interface ControlledActivationIncidentPlanRepository {
  createIncidentPlan(plan: ControlledActivationIncidentPlan): Promise<void>;
  getIncidentPlanByCandidateId(candidateId: string): Promise<ControlledActivationIncidentPlan | null>;
}
