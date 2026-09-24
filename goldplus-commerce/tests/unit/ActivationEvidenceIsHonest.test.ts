import { describe, expect, it } from 'vitest';
import { DefaultControlledActivationPayloadPreviewer } from '../../apps/api/src/infrastructure/activation/DefaultControlledActivationPayloadPreviewer';
import { DefaultControlledActivationEvidencePackBuilder } from '../../apps/api/src/infrastructure/activation/DefaultControlledActivationEvidencePackBuilder';
import { MarkActivationReadyForLiveReviewUseCase } from '../../apps/api/src/application/use-cases/activation/MarkActivationReadyForLiveReviewUseCase';

/**
 * The evidence pack stated "No PII leaks detected", "Rollback procedures verified"
 * and the preview was a fixed Meta PURCHASE with consent GRANTED — none computed.
 */
describe('controlled-activation evidence states only what was checked', () => {
  it('the preview says it is not built, and blocks the dry run', async () => {
    const [preview] = await new DefaultControlledActivationPayloadPreviewer().generatePreviews('dr-1', 'ar-1');
    expect(preview.status).toBe('BLOCKED');
    expect(preview.consentStatus).not.toBe('GRANTED');
    expect(preview.redactedPayload).toBeNull();
    expect(preview.blockedReason).toMatch(/^Not verified/);
  });

  it('the evidence pack claims nothing it did not verify', async () => {
    const pack = await new DefaultControlledActivationEvidencePackBuilder().buildEvidencePack('dr-1', 'ar-1');
    const text = JSON.stringify(pack);
    expect(text).not.toMatch(/No PII leaks detected|verified successfully|procedures verified|provisioned|upheld|passed/i);
    expect(pack.rollbackSummary).toMatch(/^Not verified/);
  });

  it('marking ready for live review fails closed when no previews are found', async () => {
    const uc = new MarkActivationReadyForLiveReviewUseCase(
      { getExecutionPlan: async () => ({ id: 'p', activationRequestId: 'ar' }), updateExecutionPlanStatus: async () => undefined } as never,
      { getDryRunsForPlan: async () => [{ id: 'dr', status: 'PASSED' }] } as never,
      { getEvidencePack: async () => ({ id: 'e' }) } as never,
      { getPreviewsForDryRun: async () => [] } as never,
      { runChecks: async () => [] } as never,
    );
    await expect(uc.execute({ adminId: 'a', executionPlanId: 'p' })).rejects.toThrow('Payload previews are required');
  });
});
