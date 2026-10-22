import { describe, expect, it } from 'vitest';
import { VerifyPesaPalPaymentUseCase } from '../../apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase';
import { DomainError } from '../../apps/api/src/domain/errors/DomainError';
import type { RecordedPaymentAttempt } from '../../apps/api/src/application/ports/IPesaPalPaymentRepository';

/**
 * A replay of a COMPLETED attempt (Pesapal's callback after its IPN, a retried IPN) was answered from the attempt
 * alone. Two money bugs followed (2026-10-22 review):
 *  - a payment that arrived after the order was cancelled went to review on the IPN, then the callback's replay
 *    answered plain "completed" and reconcile CONFIRMED it: "payment received" text, paid-order alerts, card capture;
 *  - a crash between the attempt write and the order move left a paid order unpaid, and every retry answered
 *    "completed" without moving it, until abandonment cancelled it at 48 h.
 * The replay now re-asserts the order move under the same idempotency key.
 */
function world(orderAccepts: 'yes' | 'cancelled' | 'crash-once') {
  const attempt: RecordedPaymentAttempt = {
    id: 'a1', orderId: 'o1', merchantReference: 'GP-1', orderTrackingId: 't1', amount: 50_000, currency: 'UGX',
    status: 'pending', redirectUrl: 'https://pay/1', provider: 'pesapal', ipnReceivedAt: null, callbackReceivedAt: null,
    createdAt: new Date(Date.now() - 3_600_000), updatedAt: new Date(),
  };
  const order = { status: 'received', paymentStatus: 'unpaid' };
  const events = new Set<string>();
  let crashed = false;
  const verify = new VerifyPesaPalPaymentUseCase(
    {
      findByTrackingId: async () => attempt,
      updatePaymentAttemptStatus: async (_id: string, patch: { status?: string }) => { if (patch.status) attempt.status = patch.status; },
      updateOrderPaymentStatusSafely: async (_o: string, s: string) => { order.paymentStatus = s; return true; },
    } as never,
    { getTransactionStatus: async () => ({ status_code: 1, payment_status_description: 'Completed', merchant_reference: 'GP-1', amount: 50_000, currency: 'UGX' }) } as never,
    {
      transition: async (_o: string, to: string, ctx: { idempotencyKey: string; paymentStatus?: string }) => {
        if (events.has(ctx.idempotencyKey)) return; // the real service hands back the existing event
        if (orderAccepts === 'cancelled') throw new DomainError('ORDER_TRANSITION_ILLEGAL', 'CONFLICT', 'cancelled -> processing');
        if (orderAccepts === 'crash-once' && !crashed) { crashed = true; throw new Error('connection reset'); }
        events.add(ctx.idempotencyKey);
        order.status = to;
        if (ctx.paymentStatus) order.paymentStatus = ctx.paymentStatus;
      },
    } as never,
  );
  const settle = (source: 'ipn' | 'callback') => verify.execute({ orderTrackingId: 't1', merchantReference: 'GP-1', source });
  return { settle, order, events };
}

describe('a replay of a completed payment re-checks the order', () => {
  it('a late payment on a cancelled order stays a conflict on every replay (never "confirmed")', async () => {
    const w = world('cancelled');
    expect((await w.settle('ipn')).lifecycleConflict).toBe(true);
    const replay = await w.settle('callback');
    expect(replay.lifecycleConflict).toBe(true);
    expect(replay.status).toBe('completed');
  });

  it('a crash after the attempt was written is finished by the retry', async () => {
    const w = world('crash-once');
    await expect(w.settle('ipn')).rejects.toThrow('connection reset');
    expect(w.order.status).toBe('received');
    const retry = await w.settle('ipn');
    expect(retry).toMatchObject({ ok: true, status: 'completed' });
    expect(retry.lifecycleConflict).toBeUndefined();
    expect(w.order).toEqual({ status: 'processing', paymentStatus: 'paid' });
  });

  it('an ordinary replay is still a quiet no-op (one event, no conflict)', async () => {
    const w = world('yes');
    await w.settle('ipn');
    const replay = await w.settle('callback');
    expect(replay).toMatchObject({ ok: true, status: 'completed' });
    expect(replay.lifecycleConflict).toBeUndefined();
    expect(w.events.size).toBe(1);
  });
});
