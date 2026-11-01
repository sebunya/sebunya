import { describe, expect, it, vi } from 'vitest';
import { ApplyRefundConsequencesUseCase } from '../../apps/api/src/application/use-cases/payments/ApplyRefundConsequencesUseCase';

/**
 * Order of 100,000: 80,000 from a gift card, 20,000 through Pesapal. Staff refund the 20,000 (an item out of stock).
 * Read against the cash alone that was a TOTAL refund: the order was cancelled and the cancellation returned the
 * card's 80,000 too (2026-10-22 review). With card money on the order it is partial; cancelling stays a person's call.
 */
function world(creditUgx: number) {
  const paymentRepo = { updatePaymentAttemptStatus: vi.fn().mockResolvedValue(undefined), updateOrderPaymentStatusSafely: vi.fn().mockResolvedValue(true), findAttemptsByOrderId: vi.fn().mockResolvedValue([]) };
  const orderTransition = { transition: vi.fn().mockResolvedValue(undefined), history: vi.fn() };
  const loyalty = { execute: vi.fn().mockResolvedValue(undefined) };
  const uc = new ApplyRefundConsequencesUseCase(paymentRepo as never, orderTransition as never, { getRefundedTotalUgx: async () => 20_000 }, loyalty, undefined, async () => creditUgx);
  const attempt = { id: 'att-1', orderId: 'order-1', amount: 20_000, orderTrackingId: 't', merchantReference: 'GP-1' };
  return { uc, attempt, orderTransition };
}
const ctx = { actorType: 'system', source: 'payment', providerConfirmed: true } as never;

describe('a refund on an order a gift card partly paid', () => {
  it('all the cash back is a partial refund of the order: never cancelled automatically', async () => {
    const w = world(80_000);
    const r = await w.uc.execute(w.attempt as never, ctx);
    expect(r.reading).toBe('partial');
    expect(w.orderTransition.transition).not.toHaveBeenCalledWith('order-1', 'cancelled', expect.anything());
  });

  it('without card money, all the cash back is still the total refund it was', async () => {
    const w = world(0);
    const r = await w.uc.execute(w.attempt as never, ctx);
    expect(r.reading).toBe('total');
  });
});
