import { describe, expect, it } from 'vitest';

import { StartOrderPaymentUseCase } from '../../apps/api/src/application/use-cases/commerce/StartOrderPaymentUseCase';
import {
  StartPesaPalPaymentUseCase,
  withMerchantReference,
} from '../../apps/api/src/application/use-cases/payments/StartPesaPalPaymentUseCase';
import { canTransitionAttempt, type PaymentAttemptStatus } from '../../apps/api/src/domain/payments/PaymentAttemptState';

/**
 * StartOrderPaymentUseCase declines to reuse an attempt whose amount no longer
 * matches the order (a delivery variance changed the total), and hands over to
 * StartPesaPalPaymentUseCase. That use case used to find the BASE attempt,
 * reuse it because it was not terminal, re-submit the STALE amount and then
 * overwrite its tracking id — so the first provider page matched nothing on
 * our side and the new page under-collected. These tests compose both.
 */

const ORDER = {
  id: 'bbbb2222-0000-4000-8000-000000000000',
  orderNumber: 'GP-202609-BBBB2222',
  totalUgx: 155_000,
  paymentStatus: 'unpaid',
  orderStatus: 'received',
  customerName: 'Test Buyer',
  customerPhone: '+256700000000',
  customerEmail: 'buyer@example.com',
};
const BASE = `GP-${ORDER.orderNumber}-${ORDER.id.slice(0, 8)}`;

type Row = {
  id: string; orderId: string; merchantReference: string; amount: number; currency: string;
  status: string; orderTrackingId: string | null; redirectUrl: string | null; createdAt: Date;
};

function world(base: Partial<Row> | null) {
  const rows: Row[] = base
    ? [{ id: 'attempt-old', orderId: ORDER.id, merchantReference: BASE, amount: 150_000, currency: 'UGX', status: 'pending', orderTrackingId: 'TRACK-OLD', redirectUrl: 'https://pay.example/old', createdAt: new Date(), ...base }]
    : [];
  const submitted: Array<{ id: string; amount: number; cancellation_url: string }> = [];
  let n = 0;
  const paymentRepo = {
    findByMerchantReference: async (ref: string) => rows.find((r) => r.merchantReference === ref) ?? null,
    findAttemptsByOrderId: async () => rows.map((r) => ({ ...r })),
    createPaymentAttempt: async (input: any) => {
      const row: Row = { id: `attempt-${++n}`, orderTrackingId: null, redirectUrl: null, createdAt: new Date(), ...input };
      rows.push(row);
      return { ...row };
    },
    updatePaymentAttemptStatus: async (id: string, update: any) => {
      const row = rows.find((r) => r.id === id)!;
      if (!canTransitionAttempt(row.status as PaymentAttemptStatus, update.status)) {
        throw new Error(`PAYMENT_STATE_ILLEGAL_TRANSITION: ${row.status} -> ${update.status}`);
      }
      Object.assign(row, update);
      return { ...row };
    },
  };
  const client = {
    submitOrderRequest: async (req: any) => {
      submitted.push({ id: req.id, amount: req.amount, cancellation_url: req.cancellation_url });
      return { order_tracking_id: `TRACK-NEW-${submitted.length}`, redirect_url: 'https://pay.example/new' };
    },
  };
  process.env.PESAPAL_IPN_ID = 'ipn-1';
  const provider = new StartPesaPalPaymentUseCase(paymentRepo as never, { findById: async () => ORDER } as never, client as never);
  const start = new StartOrderPaymentUseCase({
    idempotency: {
      findByOrderId: async () => ({ identity: 'ck-1', principalKey: 'p-1', stage: 'PAYMENT_STARTED' }),
      advancePaymentStage: async () => true,
    } as never,
    orders: { findById: async () => ORDER },
    attempts: paymentRepo as never,
    provider,
    sideEffectRecorder: { record: async () => 'RECORDED' } as never,
  });
  return { rows, submitted, provider, start };
}

describe('a retry after a delivery variance', () => {
  it('asks the provider for the CURRENT total under a new reference, and keeps the first page matchable', async () => {
    const { rows, submitted, start } = world({});

    const out = await start.execute({ orderId: ORDER.id, principalKey: 'p-1', traceId: 't' });

    expect(out.kind).toBe('REDIRECT_READY');
    expect(submitted).toHaveLength(1);
    expect(submitted[0].amount).toBe(155_000);
    expect(submitted[0].id).not.toBe(BASE);
    expect(submitted[0].id.startsWith(`${BASE}-`)).toBe(true);
    // The first provider transaction is still ours to match.
    const old = rows.find((r) => r.id === 'attempt-old')!;
    expect(old.orderTrackingId).toBe('TRACK-OLD');
    expect(old.amount).toBe(150_000);
    expect(old.status).toBe('pending');
  });
});

describe('the base attempt decides nothing about the provider unless it never reached it', () => {
  it('opens a fresh attempt (not an orphan) when the base attempt is verification_failed', async () => {
    const { rows, submitted, provider } = world({ status: 'verification_failed', amount: 155_000 });
    const out = await provider.execute({ orderId: ORDER.id });
    expect(submitted).toHaveLength(1);
    expect(out.orderTrackingId).toBe('TRACK-NEW-1');
    expect(rows.find((r) => r.orderTrackingId === 'TRACK-NEW-1')?.merchantReference).toBe(out.merchantReference);
    expect(rows.find((r) => r.id === 'attempt-old')!.orderTrackingId).toBe('TRACK-OLD');
  });

  it('never overwrites a stored tracking id, even at the right amount', async () => {
    const { rows, provider } = world({ status: 'pending', amount: 155_000 });
    await provider.execute({ orderId: ORDER.id });
    expect(rows.find((r) => r.id === 'attempt-old')!.orderTrackingId).toBe('TRACK-OLD');
  });

  it('refuses before calling the provider when the base attempt already completed', async () => {
    const { submitted, provider } = world({ status: 'completed', amount: 155_000 });
    await expect(provider.execute({ orderId: ORDER.id })).rejects.toThrow(/^PAYMENT_ALREADY_COLLECTED:/);
    expect(submitted).toHaveLength(0);
  });

  it('resubmits a not_started attempt at the current total under its own reference', async () => {
    const { rows, submitted, provider } = world({ status: 'not_started', amount: 155_000, orderTrackingId: null, redirectUrl: null });
    await provider.execute({ orderId: ORDER.id });
    expect(submitted.map((s) => s.id)).toEqual([BASE]);
    expect(rows).toHaveLength(1);
  });
});

describe('the cancel destination names the order', () => {
  it('carries the merchant reference the cancelled page reads', async () => {
    const { submitted, provider } = world(null);
    const out = await provider.execute({ orderId: ORDER.id });
    expect(submitted[0].cancellation_url).toContain(`reference=${encodeURIComponent(out.merchantReference)}`);
  });

  it('appends to a configured URL that already has a query', () => {
    expect(withMerchantReference('https://x.test/cancelled?src=pp', 'GP-GP-1-a')).toBe('https://x.test/cancelled?src=pp&reference=GP-GP-1-a');
    expect(withMerchantReference('https://x.test/cancelled', 'GP-GP-1-a')).toBe('https://x.test/cancelled?reference=GP-GP-1-a');
  });
});
