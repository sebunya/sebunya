import { describe, expect, it } from 'vitest';

import { ReconcileOrderPaymentUseCase } from '../../apps/api/src/application/use-cases/commerce/ReconcileOrderPaymentUseCase';
import {
  SettlePaymentUseCase,
  customerReturnKind,
} from '../../apps/api/src/application/use-cases/payments/SettlePaymentUseCase';

/**
 * The browser callback settles, then the return page asks again
 * (return-state), and the IPN usually beats both. By the second ask the
 * checkout is ORDER_CONFIRMED, so the settlement is ALREADY_SETTLED. Every
 * customer who had just paid used to read "This order was paid earlier. This
 * attempt did not take a second payment." These tests compose the two doors.
 */

function harness(verification: Record<string, unknown>) {
  let stage = 'PAYMENT_STARTED';
  const reconcile = new ReconcileOrderPaymentUseCase({
    idempotency: {
      async findByOrderId() { return { identity: 'ck-1', stage }; },
      async advancePaymentStage(_orderId: string, to: string, from: readonly string[]) {
        if (!from.includes(stage)) return false;
        stage = to;
        return true;
      },
    } as never,
    sideEffectRecorder: { async record() { return 'RECORDED'; } } as never,
  });
  const settle = new SettlePaymentUseCase(
    { async execute() { return { amount: 150000, currency: 'UGX', orderId: 'order-1', ...verification }; } } as never,
    reconcile,
    {
      markFulfilmentPaid: async () => {},
      settleLoyalty: async () => {},
      enqueueAdminEmail: async () => {},
      notifyFulfilmentOfPaidOrder: async () => {},
      recordMeasurement: async () => {},
      enqueueCustomerMessage: async () => {},
      onEffectFailed: () => {},
    },
  );
  const ask = async (source: 'callback' | 'ipn') =>
    customerReturnKind(await settle.execute({ orderTrackingId: 'TRACK-1', merchantReference: 'GP-GP-202609-AAAA1111-o1', source, traceId: 't' }));
  return { ask };
}

describe('payment return — callback then return-state tell the same truth', () => {
  it('a customer whose own payment completed reads success on BOTH doors', async () => {
    const { ask } = harness({ ok: true, status: 'completed' });
    expect((await ask('callback')).kind).toBe('success');
    // The return page re-asks: the order is now ORDER_CONFIRMED.
    expect((await ask('callback')).kind).toBe('success');
  });

  it('an IPN that settled first still leaves the browser reading success', async () => {
    const { ask } = harness({ ok: true, status: 'completed' });
    await ask('ipn');
    expect((await ask('callback')).kind).toBe('success');
  });

  it('already_settled is kept for an attempt that did NOT pay (another attempt did)', () => {
    const settlement = { kind: 'ALREADY_SETTLED', orderId: 'o', stage: 'ORDER_CONFIRMED', reason: 'ALREADY_CONFIRMED' } as const;
    expect(customerReturnKind({ settlement, verification: { ok: false, status: 'failed', superseded: true } as never }).kind).toBe('already_settled');
    expect(customerReturnKind({ settlement, verification: { ok: false, status: 'pending' } as never }).kind).toBe('already_settled');
    expect(customerReturnKind({ settlement, verification: { ok: true, status: 'completed', lifecycleConflict: true } as never }).kind).toBe('already_settled');
  });

  it('non-settled outcomes pass through lower-cased', () => {
    expect(customerReturnKind({
      settlement: { kind: 'PENDING', orderId: 'o', stage: null, reason: 'PAYMENT_PENDING' },
      verification: { ok: false, status: 'pending' } as never,
    })).toEqual({ kind: 'pending', code: 'PAYMENT_PENDING' });
  });
});
