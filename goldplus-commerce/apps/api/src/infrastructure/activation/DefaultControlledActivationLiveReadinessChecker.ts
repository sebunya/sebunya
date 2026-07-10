import { randomUUID } from 'crypto';
import { ControlledActivationLiveReadinessChecker } from '../../application/ports/activation/ControlledActivationLiveReadinessChecker';
import { LiveReadinessCheck } from '../../application/ports/activation/ControlledActivationLiveReviewRepository';
import { ActivationDryRun } from '../../application/ports/activation/ControlledActivationDryRunRepository';
import { EvidencePack } from '../../application/ports/activation/ControlledActivationEvidencePackBuilder';
import { CanaryPlan } from '../../application/ports/activation/ControlledActivationCanaryPlanner';

export class DefaultControlledActivationLiveReadinessChecker implements ControlledActivationLiveReadinessChecker {
  async checkReadiness(
    candidateId: string,
    dryRunResult: ActivationDryRun,
    evidencePack: EvidencePack,
    canaryPlan: CanaryPlan,
    activationWindowStart: Date,
    activationWindowEnd: Date
  ): Promise<LiveReadinessCheck[]> {
    const checks: LiveReadinessCheck[] = [];
    const now = new Date();

    const addCheck = (
      gateId: string,
      status: LiveReadinessCheck['status'],
      severity: LiveReadinessCheck['severity'],
      evidenceSummary: string,
      blockerReason?: string
    ) => {
      checks.push({
        id: randomUUID(),
        candidateId,
        gateId,
        status,
        severity,
        evidenceSummary,
        blockerReason,
        checkedAt: now
      });
    };

    // 1. Check Window
    if (now > activationWindowEnd) {
      addCheck(
        'WINDOW_FRESHNESS',
        'EXPIRED',
        'CRITICAL',
        `Current time ${now.toISOString()} is past activation window end ${activationWindowEnd.toISOString()}.`,
        'Activation window has closed.'
      );
    } else {
      addCheck(
        'WINDOW_FRESHNESS',
        'PASS',
        'INFO',
        `Current time is within the activation window.`
      );
    }

    // 2. Check Dry Run Status
    if (dryRunResult.status !== 'PASSED') {
      addCheck(
        'DRY_RUN_STATUS',
        'BLOCKED',
        'CRITICAL',
        `Dry run ${dryRunResult.id} status is ${dryRunResult.status}.`,
        'Dry run must be PASSED to proceed.'
      );
    } else {
       addCheck(
        'DRY_RUN_STATUS',
        'PASS',
        'INFO',
        `Dry run is PASSED.`
      );
    }

    // 3. Check Consent Safety
    if (evidencePack.consentSummary.includes('CONSENT_BLOCKED') || evidencePack.consentSummary.includes('override')) {
      addCheck(
        'CONSENT_SAFETY',
        'CONSENT_BLOCKED',
        'CRITICAL',
        'Consent review indicates blockers or override mechanisms.',
        evidencePack.consentSummary
      );
    } else {
      addCheck(
        'CONSENT_SAFETY',
        'PASS',
        'INFO',
        'Consent safety review passed without overrides.'
      );
    }

    // 4. Check Canary Scope Limits
    if (canaryPlan.percentageCap > 5) {
      addCheck(
        'CANARY_SCOPE',
        'BLOCKED',
        'CRITICAL',
        `Canary percentage cap is ${canaryPlan.percentageCap}%, which exceeds the 5% maximum safe limit.`,
        'Canary cap too high.'
      );
    } else if (canaryPlan.maxAudienceSize > 1000) {
      addCheck(
        'CANARY_SCOPE',
        'BLOCKED',
        'CRITICAL',
        `Canary audience size is ${canaryPlan.maxAudienceSize}, exceeding the 1000 safe limit.`,
        'Canary audience too large.'
      );
    } else {
      addCheck(
        'CANARY_SCOPE',
        'PASS',
        'INFO',
        'Canary scope is within safe limits.'
      );
    }

    return checks;
  }
}
