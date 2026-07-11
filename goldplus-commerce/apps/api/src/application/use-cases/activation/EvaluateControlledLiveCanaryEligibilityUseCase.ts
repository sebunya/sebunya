import { ControlledLiveCanaryRepository } from '../../ports/activation/ControlledLiveCanaryRepository.js';
import { ControlledActivationDryRunRepository } from '../../ports/activation/ControlledActivationDryRunRepository.js';
import { ControlledLiveCanaryKillSwitch } from '../../ports/activation/ControlledLiveCanaryKillSwitch.js';

export interface EvaluateEligibilityInput {
  canaryId: string;
}

export interface EligibilityResult {
  canaryId: string;
  eligible: boolean;
  status: 'READY_FOR_CANARY' | 'BLOCKED' | 'NOT_CONFIGURED';
  gates: { name: string; status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_CONFIGURED' }[];
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

    const gates: { name: string; status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_CONFIGURED' }[] = [];

    // Gate 1: Dry run status
    const dryRunPassed = dryRun.status === 'PASSED';
    gates.push({ name: 'DRY_RUN_PASSED', status: dryRunPassed ? 'PASS' : 'FAIL' });

    // Gate 2: Evidence pack
    const evidenceExists = !!dryRun.redactedEvidenceRef;
    gates.push({ name: 'EVIDENCE_PACK_EXISTS', status: evidenceExists ? 'PASS' : 'FAIL' });

    // Gate 3: Canary Plan parameters
    const canaryCapValid = canary.canaryCap > 0 && canary.canaryCap <= 1000; // Cap must be reasonable (e.g. max 1000)
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

    const allPassed = gates.every(g => g.status === 'PASS');
    const status = allPassed ? 'READY_FOR_CANARY' : (isKillSwitched ? 'BLOCKED' : 'NOT_CONFIGURED');

    await this.canaryRepo.updateCanary(canary.id, {
      status: allPassed ? 'READY_FOR_CANARY' : 'BLOCKED'
    });

    return {
      canaryId: canary.id,
      eligible: allPassed,
      status,
      gates
    };
  }
}
