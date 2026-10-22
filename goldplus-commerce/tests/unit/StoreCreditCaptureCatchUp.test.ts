import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SettlePaymentUseCase } from '../../apps/api/src/application/use-cases/payments/SettlePaymentUseCase';

/**
 * A gift card / store credit hold is captured once, inline, when the payment settles. Lost (a database blip, a
 * shutdown mid-sweep), it stayed 'held' for good and the ledger misstated card spend (2026-10-22 review). The poller's
 * catch-up now captures it too, and lists paid orders that still hold credit.
 */
describe('a lost card capture is caught up', () => {
  it('redoConfirmedEffects captures the hold (conditional, so harmless when already done)', async () => {
    const captured: string[] = [];
    const effects = {
      markFulfilmentPaid: async () => undefined,
      notifyFulfilmentOfPaidOrder: async () => undefined,
      enqueueCustomerMessage: async () => undefined,
      captureStoreCredit: async (orderId: string) => { captured.push(orderId); },
      onEffectFailed: () => undefined,
    };
    await new SettlePaymentUseCase({} as never, {} as never, effects as never).redoConfirmedEffects('order-1');
    expect(captured).toEqual(['order-1']);
  });

  it('the catch-up lists a paid order whose card hold is still held', () => {
    const q = readFileSync(new URL('../../apps/api/src/infrastructure/payments/PaidOrdersOwedEffects.ts', import.meta.url), 'utf8');
    expect(q).toContain("l.type = 'HOLD' and l.hold_state = 'held'");
  });
});
