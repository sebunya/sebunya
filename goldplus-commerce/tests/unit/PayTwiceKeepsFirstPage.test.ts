import { describe, expect, it } from 'vitest';
import { StartPesaPalPaymentUseCase } from '../../apps/api/src/application/use-cases/payments/StartPesaPalPaymentUseCase';

/**
 * The request that loses the race to record its tracking id (a second Pay tap) answers with the WINNER's page, so the
 * customer pays on the transaction we track, whichever response their browser shows (2026-10-22).
 */
const ORDER = { id: 'ef08c49e-cfc4-4758-b492-84297a29b51a', orderNumber: 'GP-202610-AB12', totalUgx: 50_000, paymentStatus: 'unpaid', customerName: 'A Buyer', customerPhone: '+256705004545', customerEmail: null };

describe('a second Pay tap', () => {
  it("is handed the first request's page, not its own orphan transaction", async () => {
    const paymentRepo = {
      findByMerchantReference: async () => null,
      createPaymentAttempt: async (input: any) => ({ id: 'att-1', status: 'not_started', currency: 'UGX', ...input }),
      recordFirstSubmission: async () => null, // another request recorded its transaction first
      findAttemptsByOrderId: async () => [{ id: 'att-1', orderTrackingId: 'trk-first', redirectUrl: 'https://pay.example/first' }],
      updatePaymentAttemptStatus: async () => undefined,
    } as never;
    const pesapal = { submitOrderRequest: async () => ({ order_tracking_id: 'trk-second', redirect_url: 'https://pay.example/second' }) } as never;
    process.env.PESAPAL_IPN_ID = 'ipn-1';
    const out = await new StartPesaPalPaymentUseCase(paymentRepo, { findById: async () => ORDER } as never, pesapal).execute({ orderId: ORDER.id } as never);
    expect(out).toMatchObject({ orderTrackingId: 'trk-first', redirectUrl: 'https://pay.example/first' });
  });
});
