import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_SUPPRESSION_REASONS,
  AutomationEligibilityGateInput,
  evaluateAutomationEligibility,
} from '../../apps/api/src/domain/automation/Automation';
import { IAutomationEligibilityRepository, AutomationFrequencyCapRequest } from '../../apps/api/src/application/ports/IAutomationEligibilityRepository';
import { AutomationSuppressionReason } from '../../apps/api/src/domain/automation/Automation';
import { EvaluateExecutionEligibilityUseCase } from '../../apps/api/src/application/use-cases/automation/EvaluateExecutionEligibilityUseCase';

const passingGate = (over: Partial<AutomationEligibilityGateInput> = {}): AutomationEligibilityGateInput => ({
  definitionPaused: false,
  requiresApproval: false,
  approvalValid: true,
  subjectId: 'subject-1',
  audienceOutcome: 'ELIGIBLE',
  consentEligible: true,
  conditionsPassed: true,
  ...over,
});

class EligibilityRepository implements IAutomationEligibilityRepository {
  suppressions: AutomationSuppressionReason[] = [];
  reservations: AutomationFrequencyCapRequest[] = [];
  capped = false;

  async recordSuppression(input: { reason: AutomationSuppressionReason }): Promise<void> {
    this.suppressions.push(input.reason);
  }

  async reserveFrequencyCap(input: AutomationFrequencyCapRequest) {
    this.reservations.push(input);
    return this.capped
      ? { reserved: false as const, reused: false as const, used: input.limit, reason: 'FREQUENCY_CAPPED' as const }
      : { reserved: true as const, reused: false as const, used: 1 };
  }
}

const useCaseInput = (over: Record<string, unknown> = {}) => ({
  ...passingGate(),
  executionId: 'execution-1',
  definitionId: 'definition-1',
  versionId: 'version-1',
  windowKey: '2026-07-19',
  frequency: { perCustomerPerWindow: 1, windowDays: 1, global: false, countsAttempts: false },
  mode: 'LIVE' as const,
  modeSuppressionReason: null,
  ...over,
});

describe('Automation A3.1 — deterministic eligibility', () => {
  it('uses one fixed fail-closed order when several gates fail', () => {
    expect(evaluateAutomationEligibility(passingGate({
      definitionPaused: true,
      requiresApproval: true,
      approvalValid: false,
      subjectId: null,
      audienceOutcome: 'IDENTITY_CONFLICT',
      consentEligible: false,
      conditionsPassed: false,
    }))).toEqual({ eligible: false, suppressionReason: 'DEFINITION_PAUSED' });
  });

  it.each([
    ['DEFINITION_PAUSED', { definitionPaused: true }],
    ['APPROVAL_REQUIRED', { requiresApproval: true, approvalValid: false }],
    ['SUBJECT_REQUIRED', { subjectId: null }],
    ['NO_PROFILE', { audienceOutcome: 'NO_PROFILE' }],
    ['NO_DATA', { audienceOutcome: 'NO_DATA' }],
    ['IDENTITY_CONFLICT', { audienceOutcome: 'IDENTITY_CONFLICT' }],
    ['STALE_PROFILE', { audienceOutcome: 'STALE_PROFILE' }],
    ['NO_CONSENT', { consentEligible: false }],
    ['AUDIENCE_INELIGIBLE', { audienceOutcome: 'INELIGIBLE' }],
    ['CONDITION_FAILED', { conditionsPassed: false }],
  ] as const)('returns exact suppression reason %s', (reason, over) => {
    expect(evaluateAutomationEligibility(passingGate(over))).toEqual({ eligible: false, suppressionReason: reason });
  });

  it('declares the complete persisted reason set including the transactional cap rejection', () => {
    expect(AUTOMATION_SUPPRESSION_REASONS).toEqual([
      'DEFINITION_PAUSED', 'APPROVAL_REQUIRED', 'SUBJECT_REQUIRED', 'NO_PROFILE', 'NO_DATA',
      'IDENTITY_CONFLICT', 'STALE_PROFILE', 'NO_CONSENT', 'AUDIENCE_INELIGIBLE',
      'CONDITION_FAILED', 'FREQUENCY_CAPPED',
    ]);
  });
});

describe('Automation A3.1 — suppression persistence and cap boundary', () => {
  it('persists the exact failed gate without touching the cap repository', async () => {
    const repo = new EligibilityRepository();
    const result = await new EvaluateExecutionEligibilityUseCase(repo).execute(useCaseInput({ consentEligible: false }));
    expect(result).toEqual({ eligible: false, suppressionReason: 'NO_CONSENT', capReserved: false, capReused: false });
    expect(repo.suppressions).toEqual(['NO_CONSENT']);
    expect(repo.reservations).toHaveLength(0);
  });

  it.each(['DRY_RUN', 'DISABLED', 'NOT_CONFIGURED'] as const)('%s consumes no cap slot', async (mode) => {
    const repo = new EligibilityRepository();
    const result = await new EvaluateExecutionEligibilityUseCase(repo).execute(useCaseInput({ mode }));
    expect(result).toMatchObject({ eligible: true, capReserved: false });
    expect(repo.reservations).toHaveLength(0);
  });

  it('SUPPRESSED persists its exact reason and consumes no cap slot', async () => {
    const repo = new EligibilityRepository();
    const result = await new EvaluateExecutionEligibilityUseCase(repo).execute(useCaseInput({
      mode: 'SUPPRESSED',
      modeSuppressionReason: 'AUDIENCE_INELIGIBLE',
    }));
    expect(result).toEqual({ eligible: false, suppressionReason: 'AUDIENCE_INELIGIBLE', capReserved: false, capReused: false });
    expect(repo.suppressions).toEqual(['AUDIENCE_INELIGIBLE']);
    expect(repo.reservations).toHaveLength(0);
  });

  it('rejects a generic SUPPRESSED mode without an exact reason', async () => {
    const repo = new EligibilityRepository();
    await expect(new EvaluateExecutionEligibilityUseCase(repo).execute(useCaseInput({ mode: 'SUPPRESSED' })))
      .rejects.toThrow('AUTOMATION_SUPPRESSION_REASON_REQUIRED');
  });

  it('reserves only after all non-provider gates pass', async () => {
    const repo = new EligibilityRepository();
    const result = await new EvaluateExecutionEligibilityUseCase(repo).execute(useCaseInput());
    expect(result).toEqual({ eligible: true, suppressionReason: null, capReserved: true, capReused: false });
    expect(repo.reservations).toHaveLength(1);
  });

  it('returns the exact cap suppression produced by transactional reservation', async () => {
    const repo = new EligibilityRepository();
    repo.capped = true;
    const result = await new EvaluateExecutionEligibilityUseCase(repo).execute(useCaseInput());
    expect(result).toEqual({ eligible: false, suppressionReason: 'FREQUENCY_CAPPED', capReserved: false, capReused: false });
  });
});
