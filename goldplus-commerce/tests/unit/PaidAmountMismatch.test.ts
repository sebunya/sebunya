import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ReconcileOrderPaymentUseCase } from '../../apps/api/src/application/use-cases/commerce/ReconcileOrderPaymentUseCase';
import { SettlePaymentUseCase } from '../../apps/api/src/application/use-cases/payments/SettlePaymentUseCase';

/**
 * A delivery fee change moves an unpaid order's total, while the payment page made before it stays payable
 * (StartPesaPalPayment deliberately keeps it). PesaPal's amount was only ever compared with that page, so a
 * customer paying the old page settled the order at the old total and nobody heard about the difference.
 */
function harness(verification: Record<string, unknown>) {
  let stage = 'PAYMENT_STARTED';
  const checks: Array<[string, number]> = [];
  const reconcile = new ReconcileOrderPaymentUseCase({
    idempotency: {
      async findByOrderId() { return { identity: 'ck-1', stage }; },
      async advancePaymentStage(_o: string, to: string, from: readonly string[]) {
        if (!from.includes(stage)) return false;
        stage = to;
        return true;
      },
    } as never,
    sideEffectRecorder: { async record() { return 'RECORDED'; } } as never,
  });
  const settle = new SettlePaymentUseCase(
    { async execute() { return { amount: 100_000, currency: 'UGX', orderId: 'order-1', ...verification }; } } as never,
    reconcile,
    {
      markFulfilmentPaid: async () => {},
      settleLoyalty: async () => {},
      enqueueAdminEmail: async () => {},
      notifyFulfilmentOfPaidOrder: async () => {},
      recordMeasurement: async () => {},
      enqueueCustomerMessage: async () => {},
      flagPaidAmountMismatch: async (orderId, paidUgx) => { checks.push([orderId, paidUgx]); },
      onEffectFailed: () => {},
    },
  );
  const run = () => settle.execute({ orderTrackingId: 'T', merchantReference: 'GP-GP-202609-AAAA1111-o1', source: 'ipn', traceId: 't' });
  return { run, checks };
}

describe('a page paid at an amount the order no longer has', () => {
  it('a confirmed payment hands the amount it collected to the check, once', async () => {
    const { run, checks } = harness({ ok: true, status: 'completed' });
    expect((await run()).confirmed).toBe(true);
    await run(); // the replay is ALREADY_SETTLED and runs nothing
    expect(checks).toEqual([['order-1', 100_000]]);
  });

  it('nothing is checked for a payment that did not confirm', async () => {
    const { run, checks } = harness({ ok: false, status: 'failed' });
    await run();
    expect(checks).toEqual([]);
  });

  it('production compares with the order total and opens one review task per order, never blocking the payment', () => {
    const src = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/Registry.ts'), 'utf8');
    const body = src.slice(src.indexOf('flagPaidAmountMismatch: async'), src.indexOf('onEffectFailed: (effect, orderId, error)'));
    expect(body).toMatch(/order\.totalUgx === paidUgx\) return/);
    expect(body).toMatch(/openPaymentReviewTask\(orderId/);
    const helper = src.slice(src.indexOf('private async openPaymentReviewTask'), src.indexOf('public readonly settlePaymentUseCase'));
    expect(helper).toMatch(/lastTitled\(title\)/);
    expect(helper).toMatch(/catch \(err\)/);
  });
});
