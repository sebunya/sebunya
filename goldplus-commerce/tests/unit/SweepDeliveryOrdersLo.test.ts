import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  FulfilmentQuote,
  applyFreeDeliveryThreshold,
  orderChargeBeforeFreeDeliveryUgx,
  orderChargeUgx,
} from '../../apps/api/src/domain/delivery/DeliveryQuoteService';
import { CheckoutUseCase } from '../../apps/api/src/application/use-cases/commerce/CheckoutUseCase';
import { Order } from '../../apps/api/src/domain/commerce/Order';
import { PricingQuote } from '../../apps/api/src/domain/pricing/PricingEvaluator';

/**
 * The delivery / orders / fulfilment sweep (P2/P3). Each block names the
 * finding it pins. Behaviour is exercised where it can be; source checks are
 * kept for wiring that only exists inside the Registry or a page.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

const explanation = {} as never;
const proportionality = (withAck: boolean) => ({
  findings: withAck
    ? [{ kind: 'fee_exceeds_value' as const, feeUgx: 11_500, subtotalUgx: 5_000, ratio: 2.3, ceiling: 0.5, proportionateAtUgx: 23_000, addToReachProportionateUgx: 18_000, freeDeliveryAtUgx: 200_000, addToReachFreeUgx: 195_000 }]
    : [],
  requiresAcknowledgement: withAck,
});

const rider = (feeUgx: number, withAck = false): FulfilmentQuote => ({
  kind: 'rider_delivery',
  mode: 'own_rider',
  feeUgx,
  expectedMinutes: 60,
  window: { kind: 'day', note: 'insufficient_sample' },
  explanation,
  proportionality: proportionality(withAck),
});

const bus = (perParcel: number, parcels: number, chargedAt: 'sending' | 'collection'): FulfilmentQuote => ({
  kind: 'bus_shipment',
  mode: 'bus_parcel',
  feeUgx: perParcel * parcels,
  perParcelFeeUgx: perParcel,
  parcelCount: parcels,
  parcelSentence: parcels === 1 ? 'Your order ships as one parcel.' : `ships as ${parcels} parcels at UGX ${perParcel} each.`,
  shipment: {
    feeUgx: perParcel,
    carrier: 'Link Bus',
    rateCardId: 'card-1',
    rateCardVersion: 1,
    parcelClass: 'small',
    transitDaysMin: 1,
    transitDaysMax: 3,
    chargedAt,
    insuranceUgx: null,
    office: null,
  } as never,
  explanation,
  proportionality: proportionality(false),
});

describe('free-delivery threshold waives the fee it advertises (finding: qualifies but charged)', () => {
  it('a basket at or over the threshold is quoted, and charged, zero', () => {
    const waived = applyFreeDeliveryThreshold(rider(11_500), { thresholdUgx: 200_000, basisUgx: 250_000 });
    expect(waived.kind).toBe('rider_delivery');
    expect(orderChargeUgx(waived)).toBe(0);
    expect(orderChargeBeforeFreeDeliveryUgx(waived)).toBe(11_500);
    expect(waived.kind !== 'unavailable' && waived.freeDelivery).toEqual({ thresholdUgx: 200_000, basisUgx: 250_000, waivedFeeUgx: 11_500 });
  });

  it('under the threshold, or with the mechanic off, the fee stands', () => {
    expect(orderChargeUgx(applyFreeDeliveryThreshold(rider(11_500), { thresholdUgx: 200_000, basisUgx: 199_999 }))).toBe(11_500);
    expect(orderChargeUgx(applyFreeDeliveryThreshold(rider(11_500), { thresholdUgx: null, basisUgx: 9_999_999 }))).toBe(11_500);
  });

  it('a zero fee needs no acknowledgement', () => {
    const waived = applyFreeDeliveryThreshold(rider(11_500, true), { thresholdUgx: 1_000, basisUgx: 5_000 });
    expect(waived.kind !== 'unavailable' && waived.proportionality.requiresAcknowledgement).toBe(false);
  });

  it('a multi-parcel bus shipment waived to zero no longer quotes a per-parcel price', () => {
    const waived = applyFreeDeliveryThreshold(bus(10_000, 2, 'sending'), { thresholdUgx: 100_000, basisUgx: 150_000 });
    expect(waived.kind === 'bus_shipment' && [waived.feeUgx, waived.perParcelFeeUgx]).toEqual([0, 0]);
    expect(waived.kind === 'bus_shipment' && waived.parcelSentence).toMatch(/Delivery is free\./);
  });

  it('the route shows progress against the same threshold, and no longer reads only the shop-wide key', () => {
    const src = read('apps/api/src/interfaces/http/routes/delivery.ts');
    expect(src).toMatch(/thresholdUgx: outcome\.freeDeliveryThresholdUgx/);
    expect(src).not.toMatch(/numeric\.free_delivery_threshold_ugx/);
  });
});

describe('a pay-on-collection bus card is never charged in the order as well (double charge)', () => {
  it('the order charges nothing for it; the carrier fee stays on the quote for display', () => {
    const q = bus(10_000, 1, 'collection');
    expect(q.kind === 'bus_shipment' && q.feeUgx).toBe(10_000);
    expect(orderChargeUgx(q)).toBe(0);
    expect(orderChargeBeforeFreeDeliveryUgx(q)).toBe(0);
  });

  it('a card paid on sending is charged in the order', () => {
    expect(orderChargeUgx(bus(10_000, 2, 'sending'))).toBe(20_000);
  });

  it('the checkout adapter charges orderChargeUgx, not the display fee', () => {
    const src = read('apps/api/src/infrastructure/Registry.ts');
    expect(src).toMatch(/const charge = orderChargeUgx\(q\);/);
    expect(src).toMatch(/feeUgx: charge,/);
  });
});

describe('checkout re-decides the free-delivery waiver on the post-promotion goods total', () => {
  const now = new Date('2026-09-24T10:00:00.000Z');
  const pricing = (shippingUgx: number, goods: number): PricingQuote => ({
    id: `q-${shippingUgx}`,
    currency: 'UGX',
    lines: [{ productId: 'p-1', sku: 'S', name: 'Item', category: 'C', canonicalUnitPriceUgx: 250_000, quantity: 1, baseSubtotalUgx: 250_000, discountUgx: 250_000 - goods, finalSubtotalUgx: goods }],
    baseSubtotalUgx: 250_000,
    adjustments: [],
    excludedCandidates: [],
    discountTotalUgx: 250_000 - goods,
    shippingUgx,
    taxUgx: 0,
    finalTotalUgx: goods + shippingUgx,
    appliedPromotionVersions: [],
    couponReference: null,
    experimentEvidence: [],
    calculationVersion: 'pricing-v1',
    evaluatedAt: now,
    expiresAt: new Date(now.getTime() + 300_000),
    decisionTrace: [],
  } as PricingQuote);

  function harness(opts: { goods: number; quotedFee: number; feeBefore: number; threshold: number }) {
    const saved: Order[] = [];
    const orders: any = {
      savePricedOrder: async ({ order }: { order: Order }) => { saved.push(order); return { order, duplicate: false }; },
    };
    const evaluator = { execute: vi.fn(async (input: { shippingUgx: number }) => pricing(input.shippingUgx, opts.goods)) };
    const quoting = {
      quote: vi.fn(async () => ({
        feeUgx: opts.quotedFee,
        confirmed: true,
        pricedBy: 'delivery_model' as const,
        mayFallBackToLegacy: false,
        capture: { quotedFeeUgx: opts.quotedFee },
        freeDeliveryThresholdUgx: opts.threshold,
        feeBeforeFreeDeliveryUgx: opts.feeBefore,
      })),
      recordQuote: vi.fn(async () => undefined),
    };
    const useCase = new CheckoutUseCase(
      orders,
      {} as any,
      null,
      {
        evaluator: evaluator as any,
        quotes: { saveQuote: vi.fn(), findQuote: vi.fn() } as any,
        capacity: { reserve: vi.fn().mockResolvedValue({ reservations: [], duplicate: false }), release: vi.fn() } as any,
        orders,
      },
      null,
      null,
      null,
      quoting,
    );
    const place = () => useCase.execute({
      customerDetails: { name: 'A', email: 'a@example.com', phone: '0772123456', deliveryArea: 'Najjera, Wakiso', deliveryAddress: 'Plot 1' },
      buyerType: 'retail',
      items: [{ productId: 'p-1', quantity: 1 }],
      clientOrderKey: `k-${Math.random()}`,
    });
    return { place, saved, evaluator, quoting };
  }

  it('list price crossed the threshold but a promotion took the goods back under: the fee is charged', async () => {
    const h = harness({ goods: 180_000, quotedFee: 0, feeBefore: 11_500, threshold: 200_000 });
    const result = await h.place();
    expect(h.evaluator.execute).toHaveBeenCalledTimes(2);
    expect(result.order.deliveryFeeUgx).toBe(11_500);
    expect(h.quoting.recordQuote.mock.calls[0][1]).toMatchObject({ quotedFeeUgx: 11_500 });
  });

  it('goods over the threshold after promotions: free, and priced once', async () => {
    const h = harness({ goods: 240_000, quotedFee: 0, feeBefore: 11_500, threshold: 200_000 });
    const result = await h.place();
    expect(h.evaluator.execute).toHaveBeenCalledTimes(1);
    expect(result.order.deliveryFeeUgx).toBe(0);
  });
});

describe('the cart/checkout same-day line names when it GOES OUT, and skips closed days', async () => {
  const { sameDayCutoffCopy, nextDispatchDayLabel } = await import('../../apps/web/src/lib/checkout');
  // Saturday 2026-09-26 18:30 EAT = 15:30 UTC.
  const saturdayEvening = new Date('2026-09-26T15:30:00.000Z');

  it('after Saturday\'s cutoff with Sunday closed, the next run is Monday, not "tomorrow"', () => {
    expect(nextDispatchDayLabel(saturdayEvening, [0])).toBe('on Monday');
    const copy = sameDayCutoffCopy({ closed: false, beforeCutoff: false, minsToCutoff: -90 }, { now: saturdayEvening, closedDays: [0] });
    expect(copy.inArea).toBe("Today's run has left. This goes out on Monday morning");
    expect(copy.inArea).not.toMatch(/tomorrow/);
  });

  it('on an ordinary weekday evening it is tomorrow', () => {
    const thursday = new Date('2026-09-24T15:30:00.000Z');
    expect(sameDayCutoffCopy({ closed: false, beforeCutoff: false, minsToCutoff: -90 }, { now: thursday, closedDays: [0] }).scoped)
      .toBe("Today's run has left. This goes out tomorrow morning");
  });

  it('before the cutoff the in-area line promises dispatch, never arrival', () => {
    const copy = sameDayCutoffCopy({ closed: false, beforeCutoff: true, minsToCutoff: 660 });
    expect(copy.inArea).toBe('Order in 11h 0m and this goes out today');
    expect(Object.values(copy).join(' ')).not.toMatch(/arrives today|get this today/);
  });

  it('with no calendar the generic wording stays true', () => {
    expect(sameDayCutoffCopy({ closed: true, beforeCutoff: false, minsToCutoff: 0 }).inArea)
      .toBe('Closed today. This goes out on the next working day');
  });
});

describe('support and quote acknowledgements reach the customer (router fall-through)', async () => {
  const { DefaultNotificationRouter } = await import('../../apps/api/src/infrastructure/notifications/NotificationRouter');
  const provider = { dispatch: vi.fn() } as any;
  const router = new DefaultNotificationRouter(provider, provider, provider);

  for (const eventType of ['SUPPORT_REQUEST_RECEIVED', 'QUOTE_REQUEST_RECEIVED', 'DEALER_APPLICATION_RECEIVED', 'FAKE_REPORT_RECEIVED']) {
    it(`${eventType} with only a customer phone produces one SMS to that phone`, async () => {
      const targets = await router.route(eventType, { customerPhone: '+256772123456', message: 'We have your request.', relatedEntityId: '6f1c2c1e-0000-4000-8000-000000000001' });
      expect(targets).toHaveLength(1);
      expect(targets[0].channel).toBe('sms');
      expect(targets[0].payload.recipient).toBe('+256772123456');
      expect(targets[0].payload.template).toBe(eventType);
    });
  }

  it('a support payload that happens to carry `recipient` never gets the internal "order is PAID" text', async () => {
    const targets = await router.route('SUPPORT_REQUEST_RECEIVED', { recipient: '+256700000000', customerPhone: '+256772123456' });
    expect(targets).toHaveLength(1);
    expect(JSON.stringify(targets[0].payload.data)).not.toMatch(/is PAID/);
    expect(targets[0].payload.recipient).toBe('+256772123456');
  });

  it('the paid-order alert is still its own case', async () => {
    const targets = await router.route('FULFILMENT_PAID_ORDER_ALERT', { recipient: '+256700000000', orderNumber: 'GP-202609-AAAA1111', totalUgx: 150000 });
    expect(targets).toHaveLength(1);
    expect(String((targets[0].payload.data as any).message)).toMatch(/is PAID/);
  });
});

describe('a cash-on-delivery order follows its task to dispatched (COD mirror)', async () => {
  const { mirrorOrderDispatched } = await import('../../apps/api/src/application/use-cases/fulfilment/DispatchUseCases');
  const { canTransitionOrder } = await import('../../apps/api/src/domain/commerce/OrderStateMachine');

  function port(initial: string, paymentStatus = 'unpaid') {
    const state = { status: initial, hops: [] as string[] };
    return {
      state,
      transition: vi.fn(async (_orderId: string, to: string) => {
        const verdict = canTransitionOrder(state.status as never, to as never, { paymentStatus: paymentStatus as never });
        if (!verdict.allowed) throw new Error(verdict.message);
        state.hops.push(`${state.status}->${to}`);
        state.status = to;
        return {} as never;
      }),
      history: vi.fn(),
    };
  }

  it('a COD order still at received is confirmed, then dispatched: two legal hops', async () => {
    const p = port('received');
    const out = await mirrorOrderDispatched(p as never, 'o-1', { actorId: 'admin-1', note: 'x', cashOnDelivery: true });
    expect(out).toBe('dispatched');
    expect(p.state.hops).toEqual(['received->processing', 'processing->dispatched']);
    expect(p.transition.mock.calls[1][2]).toMatchObject({ reasonCode: 'cod_dispatch_confirmed' });
  });

  it('a paid order already processing is dispatched in one hop', async () => {
    const p = port('processing', 'paid');
    expect(await mirrorOrderDispatched(p as never, 'o-1', { actorId: 'a', note: 'x', cashOnDelivery: false })).toBe('dispatched');
    expect(p.state.hops).toEqual(['processing->dispatched']);
  });

  it('without the COD confirmation an unconfirmed order is not moved, and says so', async () => {
    const p = port('received');
    expect(await mirrorOrderDispatched(p as never, 'o-1', { actorId: 'a', note: 'x', cashOnDelivery: false })).toBe('skipped');
    expect(p.state.hops).toEqual([]);
  });

  it('a cancelled order is never revived', async () => {
    const p = port('cancelled');
    expect(await mirrorOrderDispatched(p as never, 'o-1', { actorId: 'a', note: 'x', cashOnDelivery: true })).toBe('skipped');
    expect(p.state.hops).toEqual([]);
  });

  it('the delivery outcome catches a stranded order up before recording delivered', () => {
    const src = read('apps/api/src/application/use-cases/fulfilment/DeliveryUseCases.ts');
    expect(src).toMatch(/const caughtUp = await mirrorOrderDispatched\(/);
  });
});

describe('guest order verification compares phones and references as the same thing', async () => {
  const { verifyOrderByContact, comparablePhone } = await import('../../apps/api/src/application/services/OrderContactVerification');
  const { MemoryFailureLockout } = await import('../../apps/api/src/application/ports/FailureLockoutStore');
  const order = (phone: string) => ({ id: 'o1', orderNumber: 'GP-202609-2B3E4D39', customerEmail: null, customerPhone: phone });
  const check = async (stored: string, reference: string, contact: string) => {
    const lockout = new MemoryFailureLockout();
    const seen: string[] = [];
    const res = await verifyOrderByContact({ reference, contact, now: 1 }, {
      lockout,
      findOrder: async (ref) => { seen.push(ref); return ref === 'GP-202609-2B3E4D39' ? order(stored) : null; },
    });
    return { ok: res.ok, seen, failures: lockout.size };
  };

  it('every common way of writing the same Ugandan number verifies', async () => {
    for (const typed of ['0772123456', '+256772123456', '256772123456', '0772-123-456', '+256 772 123 456', '772123456']) {
      expect((await check('0772123456', 'GP-202609-2B3E4D39', typed)).ok).toBe(true);
    }
    expect((await check('+256772123456', 'GP-202609-2B3E4D39', '0772123456')).ok).toBe(true);
  });

  it('a lower-cased reference is the same order, and an honest retry does not count toward the lockout', async () => {
    const r = await check('0772123456', 'gp-202609-2b3e4d39', '0772123456');
    expect(r.ok).toBe(true);
    expect(r.seen).toEqual(['GP-202609-2B3E4D39']);
    expect(r.failures).toBe(0);
  });

  it('a different number still fails', async () => {
    expect((await check('0772123456', 'GP-202609-2B3E4D39', '0772123457')).ok).toBe(false);
  });

  it('the comparable form is E.164 for Ugandan numbers and digits otherwise', () => {
    expect(comparablePhone('0772 123 456')).toBe('+256772123456');
    expect(comparablePhone('+44 20 7946 0958')).toBe('442079460958');
    expect(comparablePhone('')).toBe('');
  });
});

describe('track order tells the truth about money, contrast and totals', () => {
  const page = read('apps/web/src/pages/track-order.astro');

  it('a wholesale order under review is "placed", and "preparing" makes no payment claim', () => {
    expect(page).toMatch(/if \(s === 'processing'\) return 1;/);
    expect(page).not.toMatch(/\['processing', 'pending_owner_review'\]/);
    expect(page).not.toMatch(/We have checked your payment/);
  });

  it('the unpaid sentence is true for online orders too', async () => {
    const { paymentStatusCopy } = await import('../../apps/web/src/lib/orderStatusCopy');
    expect(paymentStatusCopy('unpaid').meaning).not.toMatch(/on delivery or by invoice/);
  });

  it('upcoming steps are not faded below AA contrast; the dealer CTA is dark on lime', () => {
    expect(page).not.toMatch(/opacity-55/);
    expect(read('apps/web/src/pages/dealers/dashboard.astro')).not.toMatch(/bg-brand-primary[^"]*text-white/);
  });

  it('the follow-up goes through the verified endpoint that uses the order\'s own phone', () => {
    expect(page).toMatch(/postJson\('\/commerce\/orders\/lookup\/followup', \{ reference, contact, note \}\)/);
    expect(page).not.toMatch(/phone: isEmail \? '' : contact/);
  });

  it('line prices and the delivery fee are shown from the fields the API returns', () => {
    const route = read('apps/api/src/interfaces/http/routes/commerce.ts');
    expect(route).toMatch(/lineTotalUgx: it\.finalLineTotal \?\? it\.price \* it\.quantity/);
    expect(page).toMatch(/order\.deliveryFeeUgx/);
  });
});

describe('the order follow-up answers on the order\'s phone, whatever the customer verified with', async () => {
  const { RequestOrderFollowUpUseCase } = await import('../../apps/api/src/application/use-cases/orders/RequestOrderFollowUpUseCase');
  const { OpenSupportTicketUseCase } = await import('../../apps/api/src/application/use-cases/governance/OpenSupportTicketUseCase');
  const saved: any[] = [];
  const tickets = new OpenSupportTicketUseCase({ save: async (t: unknown) => { saved.push(t); } } as never);
  const uc = new RequestOrderFollowUpUseCase(tickets);
  const order = { orderNumber: 'GP-202609-0CB4E0F4', customerPhone: '0772123456', customerEmail: 'jury.test@example.com', deliveryArea: 'Ntinda, Kampala', orderStatus: 'processing', paymentStatus: 'paid' };

  it('an email-verified customer gets a ticket (it used to be refused for a missing phone)', async () => {
    const res = await uc.execute({ order, verifiedContact: 'jury.test@example.com', note: 'Please confirm dispatch date.' });
    expect(res.ok).toBe(true);
    expect(saved).toHaveLength(1);
  });

  it('a phone-verified customer still gets one', async () => {
    expect((await uc.execute({ order, verifiedContact: '0772123456' })).ok).toBe(true);
  });
});

describe('refunds: a provider refusal is a refusal, and a stuck reservation can be resolved', async () => {
  const { RefundPesaPalPaymentUseCase, ResolveRefundUseCase } = await import('../../apps/api/src/application/use-cases/payments/RefundPesaPalPaymentUseCase');
  const audit = { entries: [] as any[], async save(e: unknown) { this.entries.push(e); return e; } };

  const ledger = () => {
    const rows: any[] = [];
    return {
      rows,
      async reserveRefund(input: any) {
        const existing = rows.find((r) => r.idempotencyKey === input.idempotencyKey);
        if (existing) return { outcome: 'ALREADY_PROCESSED', refund: { ...existing } };
        const row = { id: `r${rows.length + 1}`, idempotencyKey: input.idempotencyKey, orderId: input.orderId, amountUgx: input.amountUgx, status: 'requested', providerStatus: null, providerMessage: null };
        rows.push(row);
        return { outcome: 'RESERVED', refund: { ...row } };
      },
      async recordProviderOutcome(id: string, update: any) {
        const row = rows.find((r) => r.id === id);
        Object.assign(row, { status: update.status, providerStatus: update.providerStatus, providerMessage: update.providerMessage });
      },
      async listRefundsForOrder(orderId: string) { return rows.filter((r) => r.orderId === orderId).map((r) => ({ ...r })); },
    };
  };
  const make = (providerAnswer: { status: string; message: string }) => {
    const l = ledger();
    const useCase = new RefundPesaPalPaymentUseCase(
      { async findByMerchantReference() { return { id: 'att-1', orderId: 'order-1', status: 'completed', amount: 100_000, orderTrackingId: 'tid-1' }; } } as never,
      {
        async getTransactionStatus() { return { confirmation_code: 'CONF-1' }; },
        async requestRefund() { return providerAnswer; },
      } as never,
      audit as never,
      l as never,
    );
    return { useCase, l };
  };
  const ask = { merchantReference: 'GP-PAID', amountUgx: 50_000, reason: 'customer returned the item within 14 days', actorId: 'ops', actorUsername: 'ops@goldplus', idempotencyKey: 'k-1' };

  it('HTTP 200 with status "500" in the body is reported as refused and releases the amount', async () => {
    const { useCase, l } = make({ status: '500', message: 'Refund amount exceeds the transaction amount' });
    const r = await useCase.execute(ask);
    expect(r).toMatchObject({ ok: false, code: 'PROVIDER_REJECTED' });
    expect(l.rows[0]).toMatchObject({ status: 'rejected', providerStatus: '500' });
    expect(audit.entries.some((e) => e.action === 'PAYMENT_REFUND_REJECTED')).toBe(true);
  });

  it('a retry on a refused key is not a false success', async () => {
    const { useCase } = make({ status: '500', message: 'nope' });
    await useCase.execute(ask);
    expect(await useCase.execute(ask)).toMatchObject({ ok: false, code: 'ALREADY_REJECTED' });
  });

  it('a 2xx reply with no status keeps the amount reserved as unknown, never released', async () => {
    const { useCase, l } = make({ status: '', message: '' });
    const r = await useCase.execute(ask);
    expect(r).toMatchObject({ ok: false, code: 'PROVIDER_STATUS_UNKNOWN' });
    expect(l.rows[0]).toMatchObject({ status: 'requested', providerStatus: 'NO_PROVIDER_STATUS' });
    expect(audit.entries.some((e) => e.action === 'PAYMENT_REFUND_PROVIDER_STATUS_UNKNOWN')).toBe(true);
    const { useCase: missing, l: l2 } = make({ message: 'ok' } as never);
    expect(await missing.execute(ask)).toMatchObject({ ok: false, code: 'PROVIDER_STATUS_UNKNOWN' });
    expect(l2.rows[0].status).toBe('requested');
  });

  it('status "200" is acceptance and stays requested for the provider to settle', async () => {
    const { useCase, l } = make({ status: '200', message: 'Refund request successfully' });
    expect((await useCase.execute(ask)).ok).toBe(true);
    expect(l.rows[0]).toMatchObject({ status: 'requested', providerStatus: '200' });
  });

  it('an operator resolves a stuck reservation, with a reason, once', async () => {
    const l = ledger();
    await l.reserveRefund({ idempotencyKey: 'x', orderId: 'order-1', amountUgx: 20_000 });
    l.rows[0].providerStatus = 'PROVIDER_CALL_FAILED';
    const resolve = new ResolveRefundUseCase(l as never, audit as never);
    expect(await resolve.execute({ orderId: 'order-1', refundId: 'r1', resolution: 'rejected', reason: 'short', actorId: 'ops' })).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
    expect(await resolve.execute({ orderId: 'order-1', refundId: 'r1', resolution: 'rejected', reason: 'PesaPal dashboard shows no refund on CONF-1', actorId: 'ops' })).toMatchObject({ ok: true, status: 'rejected' });
    expect(l.rows[0]).toMatchObject({ status: 'rejected', providerStatus: 'OPERATOR_REJECTED' });
    expect(await resolve.execute({ orderId: 'order-1', refundId: 'r1', resolution: 'settled', reason: 'changed my mind about this one', actorId: 'ops' })).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED' });
    expect(await resolve.execute({ orderId: 'order-2', refundId: 'r1', resolution: 'settled', reason: 'wrong order for this refund', actorId: 'ops' })).toMatchObject({ ok: false, code: 'REFUND_NOT_FOUND' });
  });
});

describe('the refund ledger settles only what the provider accepted', () => {
  const src = read('apps/api/src/infrastructure/db/repositories/DrizzleRefundLedgerRepository.ts');

  it('a REVERSED poll settles only accepted rows, and the partial/total reading ignores unsent ones', () => {
    const settle = src.slice(src.indexOf('async settleRefundsForAttempt'));
    expect(settle).toMatch(/status = 'requested'\s+and provider_status = \$\{PROVIDER_ACCEPTED_STATUS\}/);
    const total = src.slice(src.indexOf('async getRefundedTotalUgx'), src.indexOf('async hasOutstandingRefunds'));
    expect(total).toMatch(/status = 'settled' or \(status = 'requested' and provider_status = \$\{PROVIDER_ACCEPTED_STATUS\}\)/);
    expect(src).toMatch(/export const PROVIDER_ACCEPTED_STATUS = '200';/);
  });

  it('a settled row is never written back to requested, and is measured once', () => {
    const outcome = src.slice(src.indexOf('async recordProviderOutcome'), src.indexOf('async getRefundedTotalUgx'));
    // A settled row is final: returned from before ANY write (regression check
    // 2026-09-24: the late answer's provider_status/message overwrote it).
    expect(outcome).toMatch(/if \(wasSettled\) return;\s*const nextStatus = update\.status;/);
    expect(outcome.indexOf('if (wasSettled) return;')).toBeLessThan(outcome.indexOf('update payment_refunds'));
    expect(outcome).toMatch(/if \(nextStatus === 'settled' && !wasSettled\)/);
  });

  it('a "nothing was sent" rejection is re-armed on retry instead of answering a false success', () => {
    expect(src).toMatch(/NOTHING_SENT_PROVIDER_STATUSES = \['STATUS_LOOKUP_FAILED', 'NO_CONFIRMATION_CODE'\]/);
    expect(src).toMatch(/if \(existingRow && !rearm\)/);
    // The balance is re-checked before re-arming: the rearm write comes after it.
    expect(src.indexOf("set status = 'requested', provider_status = null")).toBeGreaterThan(src.indexOf('EXCEEDS_REFUNDABLE_BALANCE'));
  });

  it('the poller only revisits attempts with an ACCEPTED refund outstanding', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzlePaymentAttemptRepository.ts'))
      .toMatch(/eq\(paymentRefunds\.providerStatus, '200'\)/);
  });
});

describe('work owed after a confirmed payment is caught up, not lost', async () => {
  const { ReconcilePendingPaymentsUseCase } = await import('../../apps/api/src/application/use-cases/payments/ReconcilePendingPaymentsUseCase');
  const { SettlePaymentUseCase } = await import('../../apps/api/src/application/use-cases/payments/SettlePaymentUseCase');

  it('a paid order whose task never learned it gets the idempotent effects re-run', async () => {
    const log: string[] = [];
    const settle = new SettlePaymentUseCase({} as never, {} as never, {
      markFulfilmentPaid: async (id: string) => { log.push(`task:${id}`); },
      settleLoyalty: async () => { log.push('loyalty'); },
      enqueueAdminEmail: async () => { log.push('admin'); },
      notifyFulfilmentOfPaidOrder: async (id: string) => { log.push(`alert:${id}`); },
      recordMeasurement: async () => { log.push('measurement'); },
      enqueueCustomerMessage: async (id: string, t: string) => { log.push(`customer:${id}:${t}`); },
      onEffectFailed: () => {},
    } as never);
    const since: Date[] = [];
    const reconcile = new ReconcilePendingPaymentsUseCase(
      {
        listAttemptsForReconciliation: async () => [],
        listStartFailuresForAbandonment: async () => [],
        updatePaymentAttemptStatus: async () => ({}) as never,
      },
      settle,
      { pollAfterMinutes: 10, abandonStartFailuresAfterHours: 24, batchLimit: 100 },
      { windowHours: 48, listPaidOrdersAwaitingFulfilmentPayment: async (s: Date) => { since.push(s); return ['order-9']; } },
    );
    const now = new Date('2026-09-24T12:00:00Z');
    const result = await reconcile.execute(now);
    expect(result.caughtUp).toBe(1);
    expect(log).toEqual(['task:order-9', 'alert:order-9', 'customer:order-9:ORDER_PAYMENT_SUCCESS']);
    expect(since[0].toISOString()).toBe('2026-09-22T12:00:00.000Z');
  });
});

describe('one failing loyalty step does not skip the rest of a delivery', () => {
  it('vesting is isolated like the steps after it', () => {
    const src = read('apps/api/src/infrastructure/Registry.ts');
    expect(src).toMatch(/await this\.vestLoyaltyOnDeliveryUseCase\s*\.execute\(orderId\)\s*\.catch\(/);
    expect(src).not.toMatch(/await this\.vestLoyaltyOnDeliveryUseCase\.execute\(orderId\);/);
  });
});

describe('the callback and the IPN racing is a duplicate, not a review', async () => {
  const { ReconcileOrderPaymentUseCase } = await import('../../apps/api/src/application/use-cases/commerce/ReconcileOrderPaymentUseCase');

  it('the loser of the stage advance answers ALREADY_SETTLED and raises nothing', async () => {
    const reviews: string[] = [];
    let reads = 0;
    const reconcile = new ReconcileOrderPaymentUseCase({
      idempotency: {
        // Both settlements read PAYMENT_STARTED; by the re-read the winner has confirmed.
        async findByOrderId() { reads += 1; return { identity: 'ck', stage: reads === 1 ? 'PAYMENT_STARTED' : 'ORDER_CONFIRMED' }; },
        async advancePaymentStage() { return false; },
      } as never,
      sideEffectRecorder: { async record() { return 'RECORDED'; } } as never,
      observer: { onReviewRequired: (_o: string, _t: string, r: string) => reviews.push(r), onSettled: () => {} },
    } as never);
    const out = await reconcile.execute({ verification: { ok: true, orderId: 'order-1', status: 'completed' }, traceId: 't' });
    expect(out).toMatchObject({ kind: 'ALREADY_SETTLED', reason: 'ALREADY_CONFIRMED' });
    expect(reviews).toEqual([]);
  });

  it('a checkout that never reached payment is still a review', async () => {
    const reviews: string[] = [];
    const reconcile = new ReconcileOrderPaymentUseCase({
      idempotency: { async findByOrderId() { return { identity: 'ck', stage: 'CART' }; }, async advancePaymentStage() { return false; } } as never,
      sideEffectRecorder: { async record() { return 'RECORDED'; } } as never,
      observer: { onReviewRequired: (_o: string, _t: string, r: string) => reviews.push(r), onSettled: () => {} },
    } as never);
    const out = await reconcile.execute({ verification: { ok: true, orderId: 'order-1', status: 'completed' }, traceId: 't' });
    expect(out.kind).toBe('REVIEW_REQUIRED');
    expect(reviews).toEqual(['STAGE_NOT_SETTLEABLE']);
  });
});

describe('the payment receipt agrees with the money and links somewhere that works', async () => {
  const { customerEmailData } = await import('../../apps/api/src/infrastructure/notifications/email/emailTemplateData');

  it('the order total is what was charged, and a reduction is named', () => {
    const data = customerEmailData('ORDER_PAYMENT_SUCCESS', {
      customerName: 'Rob', orderNumber: 'GP-202609-ABCDEF12', totalUgx: 170_000, deliveryFeeUgx: 5_000,
      items: [{ name: 'Power bank', quantity: 1, unitPriceUgx: 185_000, lineTotalUgx: 185_000 }],
    });
    expect(data.total).toBe('UGX 170,000 (after UGX 20,000 in points and discounts)');
    expect(data.amount_received).toBe('UGX 170,000');
  });

  it('with no reduction the total is plain', () => {
    const data = customerEmailData('ORDER_PAYMENT_SUCCESS', {
      totalUgx: 190_000, deliveryFeeUgx: 5_000, items: [{ name: 'x', quantity: 1, unitPriceUgx: 185_000, lineTotalUgx: 185_000 }],
    });
    expect(data.total).toBe('UGX 190,000');
  });

  it('"View my order" opens Track Order with the reference, which works for guests', () => {
    expect(read('apps/api/src/infrastructure/Registry.ts')).toMatch(/\/track-order\?reference=\$\{encodeURIComponent\(order\.orderNumber\)\}/);
  });
});

describe('form confirmations show the reference they promise', async () => {
  const { formReference } = await import('../../apps/web/src/lib/api');
  it('support, quote, dealer and fake-report ids are the reference', () => {
    expect(formReference({ data: { ticketId: 't-1' } })).toBe('t-1');
    expect(formReference({ data: { quoteId: 'q-1' } })).toBe('q-1');
    expect(formReference({ data: { dealerId: 'd-1' } })).toBe('d-1');
    expect(formReference({ data: { reportId: 'r-1' } })).toBe('r-1');
  });
  it('the request id still serves when the record has none', () => {
    expect(formReference({ data: {}, meta: { requestId: 'req-9' } })).toBe('req-9');
    expect(formReference({ data: null })).toBeUndefined();
  });
});

describe('GET /admin/fulfilment/teams is not shadowed by /:id', () => {
  it('the static path is registered first, and a non-uuid id is a 404', () => {
    const src = read('apps/api/src/interfaces/http/routes/admin/fulfilment.ts');
    expect(src.indexOf("routes.get('/teams'")).toBeGreaterThan(-1);
    expect(src.indexOf("routes.get('/teams'")).toBeLessThan(src.indexOf("routes.get('/:id'"));
    expect(src).toMatch(/TASK_ID\.test\(id\) \?/);
  });
});

describe('an outbox retry sends only to the targets that failed', async () => {
  const { ProcessOutboxBatchUseCase } = await import('../../apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase');

  it('the admin who already has the email does not get it again', async () => {
    const sends: string[] = [];
    const provider = (fail: boolean) => ({
      dispatch: async (p: any) => { sends.push(p.recipient); return fail ? { status: 'FAILED', providerCode: '429', providerMessage: 'busy' } : { status: 'SENT', providerCode: '200', providerMessage: 'ok' }; },
    });
    let failB = true;
    const router = {
      route: async (_t: string, payload: Record<string, unknown>) => {
        expect(payload).not.toHaveProperty('_sentTargets');
        return [
          { channel: 'email', provider: provider(false), payload: { recipient: 'a@shop', template: 'ADMIN_ORDER_EMAIL', data: {}, relatedEntity: 'order', relatedEntityId: null } },
          { channel: 'email', provider: provider(failB), payload: { recipient: 'b@shop', template: 'ADMIN_ORDER_EMAIL', data: {}, relatedEntity: 'order', relatedEntityId: null } },
        ];
      },
    };
    const event: any = { id: 'e1', eventType: 'ADMIN_ORDER_EMAIL', payload: { orderNumber: 'GP-1' }, attemptCount: 0 };
    const failures: any[] = [];
    const processed: string[] = [];
    const repo: any = {
      claimDueBatch: async () => [event],
      recordFailure: async (id: string, _e: string, _n: Date, opts: any) => { failures.push(opts); event.payload = { ...event.payload, _sentTargets: opts?.sentTargets }; event.attemptCount += 1; },
      markProcessed: async (id: string) => { processed.push(id); },
    };
    const uc = new ProcessOutboxBatchUseCase(repo, router as never, { execute: async () => ({}) } as never, () => 0);

    await uc.execute();
    expect(sends).toEqual(['a@shop', 'b@shop']);
    expect(failures[0].sentTargets).toEqual(['email|a@shop|ADMIN_ORDER_EMAIL']);

    failB = false;
    sends.length = 0;
    await uc.execute();
    expect(sends).toEqual(['b@shop']);
    expect(processed).toEqual(['e1']);
  });
});
