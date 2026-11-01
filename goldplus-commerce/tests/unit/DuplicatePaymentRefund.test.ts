import { describe, it, expect, vi } from 'vitest';
import { ApplyRefundConsequencesUseCase } from '../../apps/api/src/application/use-cases/payments/ApplyRefundConsequencesUseCase';

/**
 * A customer charged twice (attempt A paid, then a late approval on attempt B) is refunded the extra payment.
 * That refund used to be read per attempt: B refunded in full read "total", and the order A had legitimately
 * paid for was cancelled, its stock released, the customer told "cancelled" and their points clawed back.
 */
const ctx = { actorType: 'system' as never, source: 'payment' as never, providerConfirmed: true, actorId: null };
const A = { id: 'att-a', orderId: 'o1', amount: 100_000, orderTrackingId: 'tA', merchantReference: 'GP-A', status: 'completed' };
const B = { id: 'att-b', orderId: 'o1', amount: 100_000, orderTrackingId: 'tB', merchantReference: 'GP-B', status: 'completed' };

function harness(opts: { attempts: Array<typeof A>; refunded: Record<string, number> }) {
  const paymentRepo = {
    updatePaymentAttemptStatus: vi.fn(),
    updateOrderPaymentStatusSafely: vi.fn(),
    findAttemptsByOrderId: vi.fn(async () => opts.attempts as never),
  };
  const transition = { transition: vi.fn() };
  const loyalty = { execute: vi.fn() };
  const fulfilment = { execute: vi.fn() };
  const ledger = { getRefundedTotalUgx: async (id: string) => opts.refunded[id] ?? 0 };
  const uc = new ApplyRefundConsequencesUseCase(paymentRepo, transition as never, ledger, loyalty, fulfilment);
  return { uc, paymentRepo, transition, loyalty, fulfilment };
}

describe('refunding the extra payment of a double charge', () => {
  it('a full refund of B reverses B only: the order A paid for is not cancelled and keeps its points', async () => {
    const h = harness({ attempts: [A, { ...B, status: 'reversed' }], refunded: { 'att-b': 100_000 } });
    const result = await h.uc.execute(B, ctx);
    expect(result).toMatchObject({ reading: 'total', coveredByAnotherPayment: true });
    expect(h.paymentRepo.updatePaymentAttemptStatus).toHaveBeenCalledWith('att-b', expect.objectContaining({ status: 'reversed' }));
    expect(h.transition.transition).not.toHaveBeenCalled();
    expect(h.paymentRepo.updateOrderPaymentStatusSafely).not.toHaveBeenCalled();
    expect(h.loyalty.execute).not.toHaveBeenCalled();
    expect(h.fulfilment.execute).not.toHaveBeenCalled();
  });

  it('a partial refund of B claws back no points from the order', async () => {
    const h = harness({ attempts: [A, B], refunded: { 'att-b': 40_000 } });
    const result = await h.uc.execute(B, ctx);
    expect(result).toMatchObject({ reading: 'partial', coveredByAnotherPayment: true });
    expect(h.paymentRepo.updatePaymentAttemptStatus).toHaveBeenCalledWith('att-b', expect.objectContaining({ status: 'completed' }));
    expect(h.loyalty.execute).not.toHaveBeenCalled();
  });

  it('refunding A instead of B is the same: either one is the extra while the other still holds the money', async () => {
    const h = harness({ attempts: [A, B], refunded: { 'att-a': 100_000 } });
    expect((await h.uc.execute(A, ctx)).coveredByAnotherPayment).toBe(true);
    expect(h.transition.transition).not.toHaveBeenCalled();
  });

  it('once the other payment has gone back too, the last refund cancels the order as before', async () => {
    const h = harness({ attempts: [{ ...A, status: 'reversed' }, B], refunded: { 'att-a': 100_000, 'att-b': 100_000 } });
    const result = await h.uc.execute(B, ctx);
    expect(result.coveredByAnotherPayment).toBeUndefined();
    expect(h.transition.transition).toHaveBeenCalledWith('o1', 'cancelled', expect.anything());
  });

  it('another payment that was itself mostly refunded does not cover this one', async () => {
    const h = harness({ attempts: [A, B], refunded: { 'att-a': 70_000, 'att-b': 100_000 } });
    const result = await h.uc.execute(B, ctx);
    expect(result.coveredByAnotherPayment).toBeUndefined();
    expect(h.transition.transition).toHaveBeenCalled();
  });

  it('a single-payment order is unchanged: a full refund cancels it', async () => {
    const h = harness({ attempts: [A], refunded: { 'att-a': 100_000 } });
    await h.uc.execute(A, ctx);
    expect(h.transition.transition).toHaveBeenCalledWith('o1', 'cancelled', expect.anything());
    expect(h.fulfilment.execute).toHaveBeenCalled();
  });
});
