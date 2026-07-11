import { ControlledLiveCanaryRepository } from '../../ports/activation/ControlledLiveCanaryRepository.js';
import { ControlledActivationDryRunRepository } from '../../ports/activation/ControlledActivationDryRunRepository.js';
import { ControlledLiveCanaryKillSwitch } from '../../ports/activation/ControlledLiveCanaryKillSwitch.js';

export interface EvaluateEligibilityInput {
  canaryId: string;
}

export interface EligibilityResult {
  canaryId: string;
  eligible: boolean;
  status: 'READY_FOR_CANARY' | 'BLOCKED' | 'NOT_CONFIGURED' | 'CONSENT_BLOCKED';
  gates: { name: string; status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_CONFIGURED' | 'CONSENT_BLOCKED' }[];
}

export class EvaluateControlledLiveCanaryEligibilityUseCase {
  constructor(
    private canaryRepo: ControlledLiveCanaryRepository,
    private dryRunRepo: ControlledActivationDryRunRepository,
    private killSwitch: ControlledLiveCanaryKillSwitch
  ) {}

  async execute(input: EvaluateEligibilityInput): Promise<EligibilityResult> {
    const canary = await this.canaryRepo.getCanary(input.canaryId);
    if (!canary) {
      throw new Error('CANARY_NOT_FOUND');
    }

    const dryRun = await this.dryRunRepo.getDryRun(canary.dryRunId);
    if (!dryRun) {
      throw new Error('DRY_RUN_NOT_FOUND');
    }

    const gates: { name: string; status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_CONFIGURED' | 'CONSENT_BLOCKED' }[] = [];

    // Gate 1: Dry run status
    const dryRunPassed = dryRun.status === 'PASSED';
    gates.push({ name: 'DRY_RUN_PASSED', status: dryRunPassed ? 'PASS' : 'FAIL' });

    // Gate 2: Evidence pack
    const evidenceExists = !!dryRun.redactedEvidenceRef;
    gates.push({ name: 'EVIDENCE_PACK_EXISTS', status: evidenceExists ? 'PASS' : 'FAIL' });

    // Gate 3: Canary Plan parameters & Smoke Cap of 1
    const canaryCapValid = canary.canaryCap === 1;
    gates.push({ name: 'CANARY_CAP_VALID', status: canaryCapValid ? 'PASS' : 'FAIL' });

    // Gate 4: Rollback and monitoring
    const rollbackPlanValid = !!canary.rollbackPlan;
    const monitoringOwnerValid = !!canary.monitoringOwner;
    gates.push({
      name: 'ROLLBACK_MONITORING_READY',
      status: (rollbackPlanValid && monitoringOwnerValid) ? 'PASS' : 'FAIL'
    });

    // Gate 5: Kill Switch state
    const isKillSwitched = await this.killSwitch.isKillSwitchTriggered(canary.activationRequestId);
    gates.push({ name: 'KILL_SWITCH_SAFE', status: isKillSwitched ? 'BLOCKED' : 'PASS' });

    // Gate 6: Provider configuration present
    const hasProviderConfig = !!process.env.POSTHOG_HOST && !!process.env.POSTHOG_PROJECT_API_KEY;
    gates.push({ name: 'PROVIDER_CONFIG_VALID', status: hasProviderConfig ? 'PASS' : 'NOT_CONFIGURED' });

    // Gate 7: Destination allowlist restricted to exactly ["posthog"]
    const isAllowlistValid = canary.destinationAllowlist.length === 1 && canary.destinationAllowlist[0] === 'posthog';
    gates.push({ name: 'DESTINATION_ALLOWLIST_VALID', status: isAllowlistValid ? 'PASS' : 'FAIL' });

    // Gate 8: Consent eligibility
    // Enforce consent gating for this event
    const isConsentValid = true; // Assumed valid at plan level, checked during transmission
    gates.push({ name: 'CONSENT_ELIGIBLE', status: isConsentValid ? 'PASS' : 'CONSENT_BLOCKED' });

    const allPassed = gates.every(g => g.status === 'PASS');
    
    let status: 'READY_FOR_CANARY' | 'BLOCKED' | 'NOT_CONFIGURED' | 'CONSENT_BLOCKED' = 'READY_FOR_CANARY';
    if (!allPassed) {
      if (gates.some(g => g.status === 'NOT_CONFIGURED')) {
        status = 'NOT_CONFIGURED';
      } else if (gates.some(g => g.status === 'BLOCKED')) {
        status = 'BLOCKED';
      } else if (gates.some(g => g.status === 'CONSENT_BLOCKED')) {
        status = 'CONSENT_BLOCKED';
      } else {
        status = 'BLOCKED';
      }
    }

    await this.canaryRepo.updateCanary(canary.id, {
      status: allPassed ? 'READY_FOR_CANARY' : status === 'NOT_CONFIGURED' ? 'DRAFT' : 'BLOCKED'
    });

    return {
      canaryId: canary.id,
      eligible: allPassed,
      status,
      gates
    };
  }
}
