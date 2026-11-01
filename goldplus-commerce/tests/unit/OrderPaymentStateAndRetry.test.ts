import { describe, expect, it } from 'vitest';
import {
  ORDER_PAYMENT_STATUSES,
  canTransitionOrderPayment,
  legalOrderPaymentExits,
  orderPaymentWriteDecision,
  type OrderPaymentStatus,
} from '../../apps/api/src/domain/payments/OrderPaymentState';

/**
 * An order can hold a DECLINED attempt and the one that paid. The provider
 * notifies per transaction and retries, so a late word about the declined
 * sibling arrives after the order is paid — and the write path, named
 * "safely", guarded nothing. Found 2026-09-20 reviewing the module after the
 * shop's first real collection.
 */
describe('the order payment status is money truth', () => {
  it('never un-pays a paid order except by a reversal', () => {
    expect(canTransitionOrderPayment('paid', 'failed')).toBe(false);
    expect(canTransitionOrderPayment('paid', 'unpaid')).toBe(false);
    expect(canTransitionOrderPayment('paid', 'reversed')).toBe(true);
    expect(orderPaymentWriteDecision('paid', 'failed')).toEqual({ write: false, reason: 'REFUSED:paid->failed' });
  });

  it('lets a later attempt pay an order whose earlier attempt failed', () => {
    expect(canTransitionOrderPayment('failed', 'paid')).toBe(true);
    expect(canTransitionOrderPayment('unpaid', 'paid')).toBe(true);
  });

  it('keeps reversed final', () => {
    expect(legalOrderPaymentExits('reversed')).toEqual([]);
    for (const to of ORDER_PAYMENT_STATUSES) {
      if (to !== 'reversed') expect(canTransitionOrderPayment('reversed', to)).toBe(false);
    }
  });

  it('refuses rather than throws, because a provider retry is not an error', () => {
    expect(orderPaymentWriteDecision('paid', 'nonsense').write).toBe(false);
    // A legacy value may be corrected once rather than bricking the row.
    expect(orderPaymentWriteDecision('weird-old-value', 'paid')).toEqual({ write: true, reason: 'UNKNOWN_CURRENT' });
  });

  it('every state except reversed has somewhere to go', () => {
    for (const s of ORDER_PAYMENT_STATUSES as readonly OrderPaymentStatus[]) {
      if (s !== 'reversed') expect(legalOrderPaymentExits(s).length).toBeGreaterThan(0);
    }
  });
});

import { StartOrderPaymentUseCase } from '../../apps/api/src/application/use-cases/commerce/StartOrderPaymentUseCase';

/**
 * "Pay again" must return the customer to the page they were just on.
 *
 * Opening a SECOND provider transaction leaves two payable pages for one order,
 * which is how a customer pays twice. A declined page stays usable — proven in
 * production on 2026-09-20, when MTN declined and the same PesaPal page then
 * took an Airtel payment.
 */
const NOW = new Date('2026-09-20T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function startPayment(attempt: { status: string; createdAt: Date; amount?: number }) {
  const submitted: string[] = [];
  const useCase = new StartOrderPaymentUseCase({
    now: () => NOW,
    idempotency: {
      findByOrderId: async () => ({ stage: 'PAYMENT_STARTED', identity: {}, principalKey: 'pk' }),
      recordPaymentProgress: async () => 'RECORDED',
      advancePaymentStage: async () => true,
    },
    orders: { findById: async () => ({ id: 'o1', paymentStatus: 'failed', totalUgx: 4000, orderStatus: 'received' }) },
    attempts: {
      findAttemptsByOrderId: async () => [{
        status: attempt.status,
        redirectUrl: 'https://pay.pesapal.com/iframe/first',
        orderTrackingId: 'trk-first',
        merchantReference: 'GP-first',
        amount: attempt.amount ?? 4000,
        createdAt: attempt.createdAt,
      }],
    },
    provider: { execute: async () => { submitted.push('new'); return { redirectUrl: 'https://pay.pesapal.com/iframe/second', orderTrackingId: 'trk-second', merchantReference: 'GP-second' }; } },
    sideEffectRecorder: { record: async () => undefined },
  } as never);
  return { useCase, submitted };
}

describe('retrying a declined payment', () => {
  it('returns to the page the customer was on, opening no second transaction', async () => {
    const { useCase, submitted } = startPayment({ status: 'failed', createdAt: minutesAgo(3) });
    const out: any = await useCase.execute({ orderId: 'o1', principalKey: 'pk', traceId: 't' });
    expect(out.kind).toBe('ALREADY_STARTED');
    expect(out.redirectUrl).toBe('https://pay.pesapal.com/iframe/first');
    expect(submitted).toEqual([]); // no second payable page for one order
  });

  it('opens a fresh transaction once that page is too old to trust', async () => {
    const { useCase, submitted } = startPayment({ status: 'failed', createdAt: minutesAgo(90) });
    const out: any = await useCase.execute({ orderId: 'o1', principalKey: 'pk', traceId: 't' });
    expect(out.kind).toBe('REDIRECT_READY');
    expect(submitted).toEqual(['new']);
  });

  it('never reuses a page that quotes the wrong money', async () => {
    const { useCase, submitted } = startPayment({ status: 'failed', createdAt: minutesAgo(3), amount: 3500 });
    const out: any = await useCase.execute({ orderId: 'o1', principalKey: 'pk', traceId: 't' });
    expect(out.kind).toBe('REDIRECT_READY');
    expect(submitted).toEqual(['new']);
  });
});
