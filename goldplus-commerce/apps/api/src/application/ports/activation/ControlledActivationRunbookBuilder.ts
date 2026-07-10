import { CanaryPlan } from './ControlledActivationCanaryPlanner';
import { ControlledActivationIncidentPlan } from './ControlledActivationIncidentPlanRepository';

export interface CanaryRunbook {
  id: string;
  candidateId: string;
  canaryScopeSummary: string;
  percentageCap: number;
  maxAudienceSize: number;
  includedSegments: string[];
  excludedSegments: string[];
  startCriteria: string;
  pauseCriteria: string;
  rollbackCriteria: string;
  successCriteria: string;
  failureCriteria: string;
  monitoringCadence: string;
  createdAt: Date;
}

export interface ControlledActivationRunbookBuilder {
  buildRunbook(
    candidateId: string,
    canaryPlan: CanaryPlan,
    incidentPlan: ControlledActivationIncidentPlan
  ): Promise<CanaryRunbook>;
  getRunbookByCandidateId(candidateId: string): Promise<CanaryRunbook | null>;
}
