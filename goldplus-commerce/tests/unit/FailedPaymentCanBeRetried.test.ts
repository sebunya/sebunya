import { describe, expect, it } from 'vitest';
import { StartPesaPalPaymentUseCase } from '../../apps/api/src/application/use-cases/payments/StartPesaPalPaymentUseCase';
import {
  TERMINAL_ATTEMPT_STATUSES,
  canTransitionAttempt,
  type PaymentAttemptStatus,
} from '../../apps/api/src/domain/payments/PaymentAttemptState';

/**
 * A customer whose payment failed must be able to pay again.
 *
 * WHAT WAS WRONG
 * The merchant reference was derived only from the order (`GP-<orderNumber>-<id8>`)
 * and the column is UNIQUE, so it was identical on every retry. After a decline
 * or an abandoned page — the most common outcome on Ugandan mobile money — the
 * lookup returned that same TERMINAL attempt. `failed`, `invalid`, `reversed`
 * and `abandoned` have no legal exit, so the use case:
 *
 *   1. asked PesaPal for a NEW live transaction, then
 *   2. threw PAYMENT_STATE_ILLEGAL_TRANSITION writing 'pending' over 'invalid'.
 *
 * The customer saw "payment could not be started" for that order forever, and
 * every attempt left a real provider transaction whose tracking id was never
 * stored — so had they paid it, nothing on our side would have matched it.
 *
 * Observed in production: order GP-202608-EF08 (payment_status `failed`, attempt
 * `invalid`) on 2026-08-27.
 */

const ORDER = {
  id: 'ef08c49e-cfc4-4758-b492-84297a29b51a',
  orderNumber: 'GP-202608-EF08',
  totalUgx: 145_000,
  paymentStatus: 'unpaid',
  customerName: 'Mr Mutambuze',
  customerPhone: '+256705004545',
  customerEmail: 'buyer@example.com',
};

function build(existingStatus: string | null) {
  const created: Array<{ merchantReference: string }> = [];
  const submitted: string[] = [];
  const written: Array<{ status: string }> = [];

  const paymentRepo = {
    findByMerchantReference: async (ref: string) =>
      existingStatus && ref === `GP-${ORDER.orderNumber}-${ORDER.id.slice(0, 8)}`.slice(0, 43)
        ? { id: 'attempt-old', merchantReference: ref, amount: ORDER.totalUgx, currency: 'UGX', status: existingStatus }
        : null,
    createPaymentAttempt: async (input: any) => {
      created.push({ merchantReference: input.merchantReference });
      return { id: 'attempt-new', ...input };
    },
    updatePaymentAttemptStatus: async (_id: string, update: any) => {
      // The real repository asserts the transition; mirror that here so an
      // illegal write fails the test rather than passing silently.
      if (existingStatus && _id === 'attempt-old') {
        if (!canTransitionAttempt(existingStatus as PaymentAttemptStatus, update.status)) {
          throw new Error(`PAYMENT_STATE_ILLEGAL_TRANSITION: ${existingStatus} -> ${update.status}`);
        }
      }
      written.push({ status: update.status });
    },
  } as never;

  const orderRepo = { findById: async () => ORDER } as never;
  const pesapalClient = {
    submitOrderRequest: async (req: any) => {
      submitted.push(req.id);
      return { order_tracking_id: 'trk-1', redirect_url: 'https://pay.example/x' };
    },
  } as never;

  process.env.PESAPAL_IPN_ID = 'ipn-1';
  return {
    useCase: new StartPesaPalPaymentUseCase(paymentRepo, orderRepo, pesapalClient),
    created,
    submitted,
    written,
  };
}

describe('every terminal attempt status is genuinely a dead end', () => {
  it('has no legal exit, so it can never be written back to pending', () => {
    for (const status of TERMINAL_ATTEMPT_STATUSES) {
      expect(canTransitionAttempt(status, 'pending')).toBe(false);
    }
  });
});

describe('after a failed or abandoned payment', () => {
  for (const status of ['failed', 'invalid', 'abandoned', 'reversed'] as const) {
    it(`starts a NEW attempt under a NEW reference when the last one is ${status}`, async () => {
      const { useCase, created, submitted } = build(status);

      const out = await useCase.execute({ orderId: ORDER.id });

      const base = `GP-${ORDER.orderNumber}-${ORDER.id.slice(0, 8)}`.slice(0, 43);
      expect(created).toHaveLength(1);
      expect(created[0].merchantReference).not.toBe(base);
      expect(created[0].merchantReference.startsWith(base)).toBe(true);
      // The provider is asked under the reference we actually stored, and the
      // caller is told the same one.
      expect(submitted).toEqual([created[0].merchantReference]);
      expect(out.merchantReference).toBe(created[0].merchantReference);
      // Provider references have a 50-character limit.
      expect(created[0].merchantReference.length).toBeLessThanOrEqual(50);
    });
  }

  it('gives each retry its own reference', async () => {
    const a = build('failed');
    const b = build('failed');
    await a.useCase.execute({ orderId: ORDER.id });
    await b.useCase.execute({ orderId: ORDER.id });
    expect(a.created[0].merchantReference).not.toBe(b.created[0].merchantReference);
  });
});

describe('what must NOT change', () => {
  it('still reuses a live attempt rather than opening a second transaction', async () => {
    const { useCase, created, submitted } = build('pending');
    await useCase.execute({ orderId: ORDER.id });
    expect(created).toHaveLength(0);
    expect(submitted).toEqual([`GP-${ORDER.orderNumber}-${ORDER.id.slice(0, 8)}`.slice(0, 43)]);
  });

  it('creates exactly one attempt when there is no history', async () => {
    const { useCase, created } = build(null);
    await useCase.execute({ orderId: ORDER.id });
    expect(created).toHaveLength(1);
  });
});
