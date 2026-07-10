import { LiveReadinessCheck } from './ControlledActivationLiveReviewRepository';
import { ActivationDryRun } from './ControlledActivationDryRunRepository';
import { EvidencePack } from './ControlledActivationEvidencePackBuilder';
import { CanaryPlan } from './ControlledActivationCanaryPlanner';

export interface ControlledActivationLiveReadinessChecker {
  checkReadiness(
    candidateId: string,
    dryRunResult: ActivationDryRun,
    evidencePack: EvidencePack,
    canaryPlan: CanaryPlan,
    activationWindowStart: Date,
    activationWindowEnd: Date
  ): Promise<LiveReadinessCheck[]>;
}
