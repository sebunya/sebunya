import { describe, expect, it, vi } from 'vitest';
import { VerifyPesaPalPaymentUseCase } from '../../apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase';
import {
  ApplyRefundToLoyaltyUseCase,
  ClawbackOrderEarnUseCase,
} from '../../apps/api/src/application/use-cases/loyalty/LoyaltyCompletionUseCases';
import { ReleaseCancelledOrderHoldsUseCase } from '../../apps/api/src/application/use-cases/commerce/ReleaseCancelledOrderHoldsUseCase';
import { DomainError } from '../../apps/api/src/domain/errors/DomainError';

/**
 * Points vest on delivered/completed, both terminal, so a refund of a delivered
 * order could never cancel it and the clawback subscriber never ran; a partial
 * refund never moves the order at all. The payment fact now carries it.
 */

const attempt = {
  id: 'att-1', orderId: 'order-1', merchantReference: 'ref-1', orderTrackingId: 'trk-1', amount: 500_000, currency: 'UGX',
  status: 'completed', redirectUrl: null, provider: 'pesapal', ipnReceivedAt: null, callbackReceivedAt: null, createdAt: new Date(), updatedAt: new Date(),
};

function verify(opts: { refunded: number; transition: () => Promise<unknown> }) {
  const refundLoyalty = { execute: vi.fn().mockResolvedValue(undefined) };
  const uc = new VerifyPesaPalPaymentUseCase(
    {
      findByTrackingId: vi.fn().mockResolvedValue(attempt),
      updatePaymentAttemptStatus: vi.fn(),
      updateOrderPaymentStatusSafely: vi.fn().mockResolvedValue(true),
    } as never,
    { getTransactionStatus: vi.fn().mockResolvedValue({ merchant_reference: 'ref-1', amount: 500_000, currency: 'UGX', status_code: 3, payment_status_description: 'REVERSED' }) } as never,
    { transition: vi.fn().mockImplementation(opts.transition), history: vi.fn() } as never,
    {
      hasOutstandingRefunds: vi.fn().mockResolvedValue(true),
      getRefundedTotalUgx: vi.fn().mockResolvedValue(opts.refunded),
      settleRefundsForAttempt: vi.fn(),
    } as never,
    refundLoyalty,
  );
  return { uc, refundLoyalty };
}

describe('a refund reaches loyalty even when the order cannot move', () => {
  it('a full reversal of a delivered order claws back through the payment fact', async () => {
    const { uc, refundLoyalty } = verify({ refunded: 500_000, transition: () => Promise.reject(new DomainError('Illegal transition delivered -> cancelled')) });
    const out = await uc.execute({ orderTrackingId: 'trk-1', merchantReference: 'ref-1', source: 'poll' });
    expect(out.lifecycleConflict).toBe(true);
    expect(refundLoyalty.execute).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', refundedShareBps: 10_000 }));
  });

  it('a proven partial refund claws back the refunded share', async () => {
    const { uc, refundLoyalty } = verify({ refunded: 125_000, transition: () => Promise.resolve({}) });
    await uc.execute({ orderTrackingId: 'trk-1', merchantReference: 'ref-1', source: 'poll' });
    expect(refundLoyalty.execute).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', refundedShareBps: 2_500 }));
  });

  it('a loyalty failure never fails the payment verification', async () => {
    const { uc, refundLoyalty } = verify({ refunded: 125_000, transition: () => Promise.resolve({}) });
    refundLoyalty.execute.mockRejectedValue(new Error('db down'));
    const out = await uc.execute({ orderTrackingId: 'trk-1', merchantReference: 'ref-1', source: 'poll' });
    expect(out.status).toBe('completed');
  });
});

describe('the payment path claws the share refunded TO DATE, once', () => {
  function clawback(earnPoints: number) {
    const ledger: Array<{ points: number; key: string }> = [];
    const repo = {
      append: vi.fn(async (e: { points: number; idempotencyKey: string }) => {
        const seen = ledger.find((l) => l.key === e.idempotencyKey);
        if (seen) return { entry: { id: 'x', points: seen.points }, replay: true };
        ledger.push({ points: e.points, key: e.idempotencyKey });
        return { entry: { id: `e${ledger.length}`, points: e.points }, replay: false };
      }),
    };
    const completion = {
      findEarnEntryForOrder: async () => ({ id: 'earn-1', accountId: 'acc-1', points: earnPoints }),
      sumReversedPointsForEntry: async () => -ledger.reduce((a, l) => a + l.points, 0),
    };
    const audit = { create: vi.fn(), log: vi.fn() };
    return { uc: new ClawbackOrderEarnUseCase(repo as never, completion as never, { ...audit, createLog: vi.fn(), append: vi.fn() } as never), ledger };
  }

  it('asking again with the same refunded share claws nothing more', async () => {
    const { uc, ledger } = clawback(5_000);
    const reverse = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    const apply = new ApplyRefundToLoyaltyUseCase({ execute: (i) => uc.execute(i).catch(() => ({ ok: false as const, code: 'X', message: '' })) }, reverse as never);
    await apply.execute({ orderId: 'o', refundedShareBps: 2_500, reason: 'Partial refund' });
    await apply.execute({ orderId: 'o', refundedShareBps: 2_500, reason: 'Partial refund' });
    expect(-ledger.reduce((a, l) => a + l.points, 0)).toBe(1_250);
    // A second refund raises the running share; only the difference is taken.
    await apply.execute({ orderId: 'o', refundedShareBps: 10_000, reason: 'Payment reversed by provider' });
    expect(-ledger.reduce((a, l) => a + l.points, 0)).toBe(5_000);
    expect(reverse.execute).toHaveBeenCalledTimes(1); // spent points come back only on a full refund
  });
});

describe('a cancelled order gives back points it already spent', () => {
  it('an applied redemption is reversed when release says NOT_RESERVED', async () => {
    const reverseRedemption = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    const uc = new ReleaseCancelledOrderHoldsUseCase({
      releaseInventory: { execute: vi.fn().mockResolvedValue(undefined) },
      releaseRedemption: { execute: vi.fn().mockResolvedValue({ ok: false, code: 'NOT_RESERVED', message: 'Reservation is applied.' }) },
      reverseRedemption,
    });
    await uc.execute('order-1');
    expect(reverseRedemption.execute).toHaveBeenCalledWith({ orderId: 'order-1', reason: 'Order cancelled' });
  });

  it('an open reservation is released, not reversed', async () => {
    const reverseRedemption = { execute: vi.fn() };
    const uc = new ReleaseCancelledOrderHoldsUseCase({
      releaseInventory: { execute: vi.fn().mockResolvedValue(undefined) },
      releaseRedemption: { execute: vi.fn().mockResolvedValue({ ok: true }) },
      reverseRedemption,
    });
    await uc.execute('order-1');
    expect(reverseRedemption.execute).not.toHaveBeenCalled();
  });
});
