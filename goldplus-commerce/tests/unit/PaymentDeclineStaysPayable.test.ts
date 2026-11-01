import { describe, it, expect } from 'vitest';
import { VerifyPesaPalPaymentUseCase } from '../../apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase';
import { ReconcileOrderPaymentUseCase } from '../../apps/api/src/application/use-cases/commerce/ReconcileOrderPaymentUseCase';
import { StartOrderPaymentUseCase } from '../../apps/api/src/application/use-cases/commerce/StartOrderPaymentUseCase';
import { SettlePaymentUseCase } from '../../apps/api/src/application/use-cases/payments/SettlePaymentUseCase';
import { orderPaymentWriteDecision } from '../../apps/api/src/domain/payments/OrderPaymentState';
import type { RecordedPaymentAttempt } from '../../apps/api/src/application/ports/IPesaPalPaymentRepository';

/**
 * A PesaPal decline parked the order for a person, and a parked order can never be
 * paid online again.
 *
 * The verifier answers ok:false for everything except "money arrived": a decline
 * (code 2), a final unpaid (0 → invalid), a reversal, a young unpaid attempt inside
 * the grace window and an unreachable status API. Reconcile checked `ok` BEFORE the
 * status, so every one of those went to PAYMENT_REVIEW — outside the payable trunk —
 * and the next start from checkout, the order page or pay-by-reference answered
 * NOT_PAYABLE. The unit tests only reached FAILED and PENDING by passing ok:true,
 * which the verifier never produces for them.
 *
 * These compose the REAL verifier, reconciler and payment start over one in-memory
 * checkout record, so the shape the verifier actually returns is what is settled.
 */

const ORDER = 'order-1';
const TRACKING = 'track-1';
const REFERENCE = 'GP-1';
const AMOUNT = 200_000;
const OWNER = 'g:owner-1';

function world(opts: { statusCode: number; description?: string; attemptAgeMs?: number; statusApiThrows?: boolean; reportedAmount?: number }) {
  const createdAt = new Date(Date.now() - (opts.attemptAgeMs ?? 60 * 60_000));
  const attempt: RecordedPaymentAttempt = {
    id: 'attempt-1',
    orderId: ORDER,
    merchantReference: REFERENCE,
    orderTrackingId: TRACKING,
    amount: AMOUNT,
    currency: 'UGX',
    status: 'pending',
    redirectUrl: 'https://pay.example/session-1',
    provider: 'pesapal',
    ipnReceivedAt: null,
    callbackReceivedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
  const state = { stage: 'PAYMENT_STARTED', paymentStatus: 'unpaid', orderStatus: 'received' };

  const verify = new VerifyPesaPalPaymentUseCase(
    {
      findByTrackingId: async () => attempt,
      updatePaymentAttemptStatus: async (_id: string, patch: { status: string }) => {
        attempt.status = patch.status;
      },
      // The real repository's guard: the order's payment state machine decides.
      updateOrderPaymentStatusSafely: async (_orderId: string, status: string) => {
        if (!orderPaymentWriteDecision(state.paymentStatus, status).write) return false;
        state.paymentStatus = status;
        return true;
      },
    } as never,
    {
      getTransactionStatus: async () => {
        if (opts.statusApiThrows) throw new Error('timeout');
        return {
          status_code: opts.statusCode,
          payment_status_description: opts.description ?? '',
          merchant_reference: REFERENCE,
          amount: opts.reportedAmount ?? AMOUNT,
          currency: 'UGX',
        };
      },
    } as never,
    {
      transition: async (_orderId: string, to: string, meta: { paymentStatus?: string }) => {
        state.orderStatus = to;
        if (meta.paymentStatus) state.paymentStatus = meta.paymentStatus;
      },
    } as never,
  );

  const idempotency = {
    findByOrderId: async () => ({
      identity: 'checkout-identity-1',
      principalKey: OWNER,
      fingerprint: 'fp',
      state: 'COMPLETED',
      operationState: 'TERMINAL',
      stage: state.stage,
      orderId: ORDER,
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    }),
    advancePaymentStage: async (_orderId: string, stage: string, from: readonly string[]) => {
      if (!from.includes(state.stage)) return false;
      state.stage = stage;
      return true;
    },
  };
  const recorder = { record: async () => 'DURABLY_RECORDED' as const, recordedTypes: async () => [] };

  const reconcile = new ReconcileOrderPaymentUseCase({ idempotency, sideEffectRecorder: recorder } as never);
  const start = new StartOrderPaymentUseCase({
    idempotency,
    orders: {
      findById: async () => ({ id: ORDER, paymentStatus: state.paymentStatus, orderStatus: state.orderStatus, totalUgx: AMOUNT }),
    },
    attempts: { findAttemptsByOrderId: async () => [attempt] },
    provider: {
      execute: async () => ({
        redirectUrl: 'https://pay.example/session-2',
        orderTrackingId: 'track-2',
        merchantReference: 'GP-1-2',
      }),
    },
    sideEffectRecorder: recorder,
  } as never);

  const settle = async () => {
    const v = await verify.execute({ orderTrackingId: TRACKING, merchantReference: REFERENCE, source: 'callback' });
    return reconcile.execute({
      verification: { ok: v.ok, orderId: v.orderId, status: v.status, lifecycleConflict: v.lifecycleConflict, superseded: v.superseded },
      traceId: 't1',
    });
  };
  const retry = () => start.execute({ orderId: ORDER, principalKey: OWNER, traceId: 't2' });

  const customerMessages: string[] = [];
  const settlePayment = new SettlePaymentUseCase(verify, reconcile, {
    markFulfilmentPaid: async () => undefined,
    settleLoyalty: async () => undefined,
    enqueueAdminEmail: async () => undefined,
    notifyFulfilmentOfPaidOrder: async () => undefined,
    enqueueCustomerMessage: async (_orderId: string, template: string) => { customerMessages.push(template); },
    recordMeasurement: async () => undefined,
    onEffectFailed: () => undefined,
  });
  const settleThroughTheDoor = () =>
    settlePayment.execute({ orderTrackingId: TRACKING, merchantReference: REFERENCE, source: 'ipn', traceId: 't3' });

  return { settle, retry, state, settleThroughTheDoor, customerMessages };
}

const PAYABLE = ['REDIRECT_READY', 'ALREADY_STARTED'];

describe('a declined payment leaves the order payable', () => {
  it('a PesaPal decline (code 2) settles as FAILED, not REVIEW_REQUIRED', async () => {
    const w = world({ statusCode: 2, description: 'FAILED' });
    const outcome = await w.settle();
    expect(outcome.kind).toBe('FAILED');
    expect(w.state.stage).not.toBe('PAYMENT_REVIEW');
  });

  it('the customer can pay again after the decline', async () => {
    const w = world({ statusCode: 2, description: 'FAILED' });
    await w.settle();
    const again = await w.retry();
    expect(PAYABLE).toContain(again.kind);
  });

  it('a final unpaid (code 0 past the grace window) is FAILED and payable again', async () => {
    const w = world({ statusCode: 0, description: 'INVALID', attemptAgeMs: 48 * 3_600_000 });
    expect((await w.settle()).kind).toBe('FAILED');
    expect(PAYABLE).toContain((await w.retry()).kind);
  });

  it('a young unpaid attempt is PENDING, not parked, and stays payable', async () => {
    // The 10-minute poller used to park every customer still on the PesaPal page.
    const w = world({ statusCode: 0, description: 'INVALID', attemptAgeMs: 10_000 });
    const outcome = await w.settle();
    expect(outcome.kind).toBe('PENDING');
    expect(w.state.stage).toBe('PAYMENT_PENDING');
    expect(PAYABLE).toContain((await w.retry()).kind);
  });

  it('an unreachable status API is PENDING, not parked', async () => {
    const w = world({ statusCode: 1, statusApiThrows: true });
    expect((await w.settle()).kind).toBe('PENDING');
    expect(w.state.stage).not.toBe('PAYMENT_REVIEW');
  });

  it('a provider reversal settles as FAILED', async () => {
    const w = world({ statusCode: 3, description: 'REVERSED' });
    expect((await w.settle()).kind).toBe('FAILED');
  });

  it('an order already parked for review is released by a decline', async () => {
    const w = world({ statusCode: 2, description: 'FAILED' });
    w.state.stage = 'PAYMENT_REVIEW';
    await w.settle();
    expect(w.state.stage).toBe('PAYMENT_STARTED');
    expect(PAYABLE).toContain((await w.retry()).kind);
  });
});

describe('what a person must still decide is still parked', () => {
  it('an integrity mismatch (verification_failed) goes to review', async () => {
    // The provider reports a different amount than the attempt: we could not
    // establish what was paid, so a person decides.
    const w = world({ statusCode: 1, reportedAmount: AMOUNT - 1 });
    const outcome = await w.settle();
    expect(outcome.kind).toBe('REVIEW_REQUIRED');
    expect(outcome.reason).toBe('VERIFICATION_FAILED');
    expect(w.state.stage).toBe('PAYMENT_REVIEW');
  });

  it('a completed status that was not verified is never confirmed', async () => {
    const r = new ReconcileOrderPaymentUseCase({
      idempotency: {
        findByOrderId: async () => ({ identity: 'i', principalKey: OWNER, stage: 'PAYMENT_STARTED', orderId: ORDER }),
        advancePaymentStage: async () => true,
      },
      sideEffectRecorder: { record: async () => 'DURABLY_RECORDED', recordedTypes: async () => [] },
    } as never);
    const outcome = await r.execute({ verification: { ok: false, orderId: ORDER, status: 'completed' }, traceId: 't' });
    expect(outcome.kind).toBe('REVIEW_REQUIRED');
  });
});

describe('a late decline for another attempt never un-pays a paid order', () => {
  // An order parked in PAYMENT_REVIEW because money landed on an order that
  // could not accept it (LIFECYCLE_CONFLICT) or for an amount mismatch. Its
  // payment_status is 'paid'. A decline then arrives late for a second attempt.
  it('does not release the review', async () => {
    const w = world({ statusCode: 2, description: 'FAILED' });
    w.state.stage = 'PAYMENT_REVIEW';
    w.state.paymentStatus = 'paid';
    const outcome = await w.settle();
    expect(outcome.kind).toBe('REVIEW_REQUIRED');
    expect(outcome.reason).toBe('ORDER_ALREADY_PAID');
    expect(w.state.stage).toBe('PAYMENT_REVIEW');
    expect(w.state.paymentStatus).toBe('paid');
  });

  it('does not tell the customer the payment failed', async () => {
    const w = world({ statusCode: 2, description: 'FAILED' });
    w.state.stage = 'PAYMENT_REVIEW';
    w.state.paymentStatus = 'paid';
    const result = await w.settleThroughTheDoor();
    expect(result.settlement.kind).not.toBe('FAILED');
    expect(result.verification.superseded).toBe(true);
    expect(w.customerMessages).toEqual([]);
  });

  it('a final unpaid (code 0 past grace) on a paid order is not FAILED either', async () => {
    const w = world({ statusCode: 0, description: 'INVALID', attemptAgeMs: 48 * 3_600_000 });
    w.state.paymentStatus = 'paid';
    const result = await w.settleThroughTheDoor();
    expect(result.settlement.kind).toBe('ALREADY_SETTLED');
    expect(result.settlement.reason).toBe('ORDER_ALREADY_PAID');
    expect(w.state.stage).toBe('PAYMENT_STARTED');
    expect(w.customerMessages).toEqual([]);
  });

  it('an ordinary decline on an unpaid order still sends ORDER_PAYMENT_FAILED once', async () => {
    const w = world({ statusCode: 2, description: 'FAILED' });
    const result = await w.settleThroughTheDoor();
    expect(result.settlement.kind).toBe('FAILED');
    expect(w.customerMessages).toEqual(['ORDER_PAYMENT_FAILED']);
  });
});
