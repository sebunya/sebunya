import { describe, expect, it } from 'vitest';
import { VerifyPesaPalPaymentUseCase } from '../../apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase';
import { ReconcileOrderPaymentUseCase, type ReconcileOrderPaymentDeps } from '../../apps/api/src/application/use-cases/commerce/ReconcileOrderPaymentUseCase';
import { DomainError } from '../../apps/api/src/domain/errors/DomainError';
import type { RecordedPaymentAttempt } from '../../apps/api/src/application/ports/IPesaPalPaymentRepository';

/**
 * Payment review 2026-11: verify -> reconcile, end to end through the ports.
 * Each world holds attempts, an order, and a checkout stage; the transition
 * fake models the real service's owner-review hold (no event, no move).
 */
const mk = (id: string, ref: string, trk: string, status = 'pending'): RecordedPaymentAttempt => ({
  id, orderId: 'o1', merchantReference: ref, orderTrackingId: trk, amount: 50_000, currency: 'UGX',
  status, redirectUrl: 'https://pay', provider: 'pesapal', ipnReceivedAt: null, callbackReceivedAt: null,
  createdAt: new Date(Date.now() - 3_600_000), updatedAt: new Date(),
} as RecordedPaymentAttempt);

function world(opts: { orderStatus: string; stage: string; providerCode?: number; attempts?: RecordedPaymentAttempt[]; partialRefund?: boolean }) {
  const attempts = opts.attempts ?? [mk('a1', 'GP-1', 't1')];
  const order = { status: opts.orderStatus, paymentStatus: 'unpaid' };
  const events = new Set<string>();
  const stamps: string[] = [];
  let stage = opts.stage;
  const reviews: string[] = [];
  const verify = new VerifyPesaPalPaymentUseCase(
    {
      findByTrackingId: async (t: string) => attempts.find((a) => a.orderTrackingId === t) ?? null,
      findAttemptsByOrderId: async () => attempts,
      updatePaymentAttemptStatus: async (id: string, patch: { status?: string; callbackReceivedAt?: Date }) => {
        const a = attempts.find((x) => x.id === id)!;
        if (patch.status) a.status = patch.status;
        if (patch.callbackReceivedAt) stamps.push(id);
      },
      updateOrderPaymentStatusSafely: async (_o: string, s: string) => { order.paymentStatus = s; return true; },
    } as never,
    {
      getTransactionStatus: async (t: string) => {
        const a = attempts.find((x) => x.orderTrackingId === t)!;
        return { status_code: opts.providerCode ?? 1, payment_status_description: 'x', merchant_reference: a.merchantReference, amount: 50_000, currency: 'UGX' };
      },
    } as never,
    {
      transition: async (_o: string, to: string, ctx: { idempotencyKey: string; paymentStatus?: string; actorType: string }) => {
        if (events.has(ctx.idempotencyKey)) return { idempotentReplay: true };
        if (order.status === 'pending_owner_review' && to === 'processing' && ctx.actorType === 'payment_provider') {
          if (ctx.paymentStatus) order.paymentStatus = ctx.paymentStatus;
          return { idempotentReplay: true, heldForOwnerReview: true };
        }
        if (order.status === to || order.status === 'cancelled') throw new DomainError('ORDER_TRANSITION_ILLEGAL', 'CONFLICT', `${order.status} -> ${to}`);
        events.add(ctx.idempotencyKey);
        order.status = to;
        if (ctx.paymentStatus) order.paymentStatus = ctx.paymentStatus;
        return { idempotentReplay: false };
      },
    } as never,
    opts.partialRefund ? ({
      hasOutstandingRefunds: async () => true,
      settleRefundsForAttempt: async () => undefined,
      getRefundedTotalUgx: async () => 10_000,
      getLandedRefundTotalUgx: async () => 10_000,
      listRefundsForOrder: async () => [],
    } as never) : undefined,
  );
  const reconcile = new ReconcileOrderPaymentUseCase({
    idempotency: {
      findByOrderId: async () => ({ identity: 'c1', stage, orderId: 'o1' }),
      advancePaymentStage: async (_o: string, next: string, from: readonly string[]) => {
        if (!from.includes(stage)) return false;
        stage = next;
        return true;
      },
    } as unknown as ReconcileOrderPaymentDeps['idempotency'],
    sideEffectRecorder: { record: async () => 'DURABLY_RECORDED', recordedTypes: async () => [] } as never,
    observer: { onSettled: () => undefined, onReviewRequired: (_o, _t, r) => reviews.push(r) },
  });
  const settle = async (trk: string, ref: string) => {
    const v = await verify.execute({ orderTrackingId: trk, merchantReference: ref, source: 'callback' });
    const s = await reconcile.execute({ verification: v, traceId: 'tr' });
    return { v, s };
  };
  return { settle, order, attempts, reviews, stamps, stage: () => stage, setOrder: (st: string) => { order.status = st; } };
}

describe('VerifyPesaPal + Reconcile (review 2026-11)', () => {
  it('a held owner-review order, once released, is not flagged as a second payment on replay', async () => {
    const w = world({ orderStatus: 'pending_owner_review', stage: 'PAYMENT_STARTED' });
    expect((await w.settle('t1', 'GP-1')).s.kind).toBe('CONFIRMED');
    w.setOrder('processing'); // the owner releases it
    const { s } = await w.settle('t1', 'GP-1');
    expect(s.reason).not.toBe('SECOND_PAYMENT_TAKEN');
    expect(w.reviews).not.toContain('SECOND_PAYMENT_TAKEN');
  });

  it('a second real payment on a held order raises SECOND_PAYMENT_TAKEN', async () => {
    const w = world({ orderStatus: 'pending_owner_review', stage: 'PAYMENT_STARTED', attempts: [mk('a1', 'GP-1', 't1'), mk('a2', 'GP-1-2', 't2')] });
    expect((await w.settle('t1', 'GP-1')).s.kind).toBe('CONFIRMED');
    const { s } = await w.settle('t2', 'GP-1-2');
    expect(s.reason).toBe('SECOND_PAYMENT_TAKEN');
  });

  it('a wrong reference on a failed attempt does not release a PAYMENT_REVIEW hold, and stamps nothing', async () => {
    const w = world({ orderStatus: 'received', stage: 'PAYMENT_REVIEW', attempts: [mk('a1', 'GP-1', 't1', 'failed')] });
    const { v, s } = await w.settle('t1', 'NOT-MINE');
    expect(v.status).not.toBe('failed');
    expect(s.kind).not.toBe('FAILED');
    expect(w.stage()).toBe('PAYMENT_REVIEW');
    expect(w.stamps).toEqual([]);
  });

  it('a REVERSED read as partial does not confirm a checkout parked in PAYMENT_REVIEW', async () => {
    const w = world({ orderStatus: 'cancelled', stage: 'PAYMENT_REVIEW', providerCode: 3, partialRefund: true, attempts: [mk('a1', 'GP-1', 't1', 'completed')] });
    const { v, s } = await w.settle('t1', 'GP-1');
    expect(v).toMatchObject({ ok: true, status: 'completed' });
    expect(v.message).toMatch(/PARTIALLY_REFUNDED/);
    expect(s.kind).not.toBe('CONFIRMED');
    expect(w.stage()).toBe('PAYMENT_REVIEW');
  });
});
