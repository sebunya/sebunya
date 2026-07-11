import { ControlledLiveCanary } from './ControlledLiveCanaryRepository.js';
import { CanaryDeliveryAttempt } from './ControlledLiveCanaryTransport.js';

export interface LiveCanaryEvidencePack {
  id: string;
  canaryId: string;
  eligibilitySummary: string;
  deliveryAttemptSummary: string;
  consentSummary: string;
  destinationSummary: string;
  rollbackSummary: string;
  monitoringSummary: string;
  createdAt: Date;
}

export interface ControlledLiveCanaryEvidenceBuilder {
  buildEvidencePack(
    canary: ControlledLiveCanary,
    attempts: CanaryDeliveryAttempt[],
    eligibilityGates: any[]
  ): Promise<LiveCanaryEvidencePack>;
}
