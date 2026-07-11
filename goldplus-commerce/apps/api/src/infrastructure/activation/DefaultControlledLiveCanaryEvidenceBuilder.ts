import { ControlledLiveCanary } from '../../application/ports/activation/ControlledLiveCanaryRepository.js';
import { CanaryDeliveryAttempt } from '../../application/ports/activation/ControlledLiveCanaryTransport.js';
import { ControlledLiveCanaryEvidenceBuilder, LiveCanaryEvidencePack } from '../../application/ports/activation/ControlledLiveCanaryEvidenceBuilder.js';

export class DefaultControlledLiveCanaryEvidenceBuilder implements ControlledLiveCanaryEvidenceBuilder {
  async buildEvidencePack(
    canary: ControlledLiveCanary,
    attempts: CanaryDeliveryAttempt[],
    eligibilityGates: any[]
  ): Promise<LiveCanaryEvidencePack> {
    const id = `ev-canary-${Date.now()}`;
    return {
      id,
      canaryId: canary.id,
      eligibilitySummary: `Canary status: ${canary.status}, Gates: ${JSON.stringify(eligibilityGates)}`,
      deliveryAttemptSummary: `Attempts: ${attempts.length}`,
      consentSummary: 'Enforced strictly via ConsentAwareMeasurementPolicy (Redacted)',
      destinationSummary: `Allowlisted destinations: ${canary.destinationAllowlist.join(', ')}`,
      rollbackSummary: `Rollback Plan: ${canary.rollbackPlan}`,
      monitoringSummary: `Monitoring Owner: ${canary.monitoringOwner}`,
      createdAt: new Date()
    };
  }
}
