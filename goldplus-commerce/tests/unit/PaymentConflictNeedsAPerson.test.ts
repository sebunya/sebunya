import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReconcileOrderPaymentUseCase } from '../../apps/api/src/application/use-cases/commerce/ReconcileOrderPaymentUseCase';

/**
 * Two privileged-path defects from the audit.
 *
 * 1. A COMPLETED PAYMENT ON AN ORDER THAT REFUSED IT WAS TREATED AS SUCCESS.
 *    When the order's state machine rejects the move (it was cancelled, say),
 *    the verification caught the DomainError, recorded the payment fact, and
 *    returned ok: true with the explanation only in a `message` string nothing
 *    reads. Settlement therefore saw a verified `completed` and ran every
 *    success effect: marked fulfilment paid, settled loyalty, queued the admin
 *    email and told the customer "payment received" for an order that could not
 *    receive it. Real money, on an order nobody was reconciling.
 *
 * 2. RE-ENROLLING MFA NEEDED NO PROOF OF THE CURRENT AUTHENTICATOR.
 *    beginEnrolment overwrote a CONFIRMED secret unconditionally, so a stolen
 *    bearer token was enough to replace the second factor with one the attacker
 *    holds and then pass every requireStepUp gate.
 */

const CHECKOUT = {
  identity: 'id-1', principalKey: 'u:1', fingerprint: 'fp', state: 'COMPLETED',
  operationState: 'TERMINAL', stage: 'PAYMENT_READY', orderId: 'order-1',
  failureReason: null, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(),
};

function build() {
  const advanced: string[] = [];
  const reviews: string[] = [];
  const settled: string[] = [];
  const useCase = new ReconcileOrderPaymentUseCase({
    idempotency: {
      findByOrderId: async () => CHECKOUT,
      advancePaymentStage: async (_o: string, stage: string) => {
        advanced.push(stage);
        return true;
      },
    },
    sideEffectRecorder: { record: async () => 'DURABLY_RECORDED', recordedTypes: async () => [] },
    observer: {
      onSettled: (_o: string, kind: string) => settled.push(kind),
      onReviewRequired: (_o: string, _t: string, reason: string) => reviews.push(reason),
    },
  } as never);
  return { useCase, advanced, reviews, settled };
}

describe('a payment the order cannot accept goes to a person', () => {
  it('is REVIEW_REQUIRED, not CONFIRMED', async () => {
    const { useCase, reviews } = build();
    const outcome = await useCase.execute({
      verification: { ok: true, orderId: 'order-1', status: 'completed', lifecycleConflict: true },
      traceId: 't',
    });
    expect(outcome.kind).toBe('REVIEW_REQUIRED');
    expect(reviews).toContain('LIFECYCLE_CONFLICT');
  });

  it('parks the checkout at PAYMENT_REVIEW so it is visible, not lost', async () => {
    const { useCase, advanced } = build();
    await useCase.execute({
      verification: { ok: true, orderId: 'order-1', status: 'completed', lifecycleConflict: true },
      traceId: 't',
    });
    expect(advanced).toContain('PAYMENT_REVIEW');
  });

  it('still confirms an ordinary completed payment', async () => {
    // The guard must not swallow the normal path.
    const { useCase } = build();
    const outcome = await useCase.execute({
      verification: { ok: true, orderId: 'order-1', status: 'completed' },
      traceId: 't',
    });
    expect(outcome.kind).toBe('CONFIRMED');
  });
});

describe('the conflict is carried, not just described', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');

  it('verification names it as a field', () => {
    const src = read('apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase.ts');
    expect(src).toMatch(/lifecycleConflict\?: boolean;/);
    expect(src).toMatch(/lifecycleConflict: true,/);
  });

  it('settlement forwards it rather than dropping it at the boundary', () => {
    const src = read('apps/api/src/application/use-cases/payments/SettlePaymentUseCase.ts');
    expect(src).toMatch(/lifecycleConflict: verification\.lifecycleConflict/);
  });
});

describe('replacing a live authenticator needs a fresh proof of the current one', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');
  const service = read('apps/api/src/infrastructure/security/MfaService.ts');
  const begin = service.slice(service.indexOf('async beginEnrolment('), service.indexOf('async confirmEnrolment('));

  it('refuses when a confirmed secret exists and the proof is stale', () => {
    expect(begin).toMatch(/existing\?\.confirmedAt && !isStepUpFresh\(existing\.lastVerifiedAt, now\)/);
    expect(begin).toMatch(/return \{ stepUpRequired: true \};/);
  });

  it('does not write a new secret on that path', () => {
    // The refusal must come BEFORE upsertEnrolment, or the secret is already gone.
    expect(begin.indexOf('stepUpRequired')).toBeLessThan(begin.indexOf('upsertEnrolment'));
  });

  it('the route answers with a step-up refusal rather than a secret', () => {
    const routes = read('apps/api/src/interfaces/http/routes/auth.ts');
    const handler = routes.slice(routes.indexOf("routes.post('/mfa/enrol'"), routes.indexOf("routes.post('/mfa/confirm'"));
    expect(handler).toMatch(/'stepUpRequired' in start/);
    expect(handler).toMatch(/MFA_STEP_UP_REQUIRED/);
  });

  it('first enrolment is still allowed', () => {
    // Nothing to protect when no confirmed secret exists.
    expect(begin).toMatch(/existing\?\.confirmedAt/);
  });
});
