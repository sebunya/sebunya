import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SettleByStoreCreditUseCase } from '../../apps/api/src/application/use-cases/payments/SettleByStoreCreditUseCase';
import { IssueCreditUseCase, ManageCreditUseCases } from '../../apps/api/src/application/use-cases/credit/CreditUseCases';
import { ReleaseCancelledOrderHoldsUseCase } from '../../apps/api/src/application/use-cases/commerce/ReleaseCancelledOrderHoldsUseCase';
import { Order } from '../../apps/api/src/domain/commerce/Order';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const tools = { hash: (c: string) => `h:${c}`, randomIndexes: () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };

function settle(order: any) {
  const calls: string[] = [];
  const uc = new SettleByStoreCreditUseCase(
    { findById: async () => order },
    { transition: async (_id: string, to: string, ctx: any) => { calls.push(`transition:${to}:${ctx.paymentStatus}:${ctx.actorType}`); return {} as any; } },
    { execute: async (i: any) => { calls.push(`reconcile:${i.verification.status}`); return { kind: 'CONFIRMED' }; } },
    { runCreditPaidEffects: async () => { calls.push('effects'); } },
  );
  return { uc, calls };
}

describe('store credit flow (gap #17)', () => {
  it('an order paid entirely by credit goes through the payment doors: paid transition, reconcile, effects', async () => {
    const { uc, calls } = settle({ id: 'o1', totalUgx: 80_000, storeCreditAppliedUgx: 80_000, paymentStatus: 'unpaid', orderStatus: 'received' });
    expect(await uc.execute('o1', 't')).toBe('settled');
    expect(calls).toEqual(['transition:processing:paid:payment_provider', 'reconcile:paid', 'effects']);
  });

  it('never settles an order credit does not cover, or one already paid', async () => {
    expect(await settle({ id: 'o', totalUgx: 80_000, storeCreditAppliedUgx: 50_000, paymentStatus: 'unpaid' }).uc.execute('o', 't')).toBe('not_fully_covered');
    expect(await settle({ id: 'o', totalUgx: 80_000, storeCreditAppliedUgx: 80_000, paymentStatus: 'paid' }).uc.execute('o', 't')).toBe('already_paid');
    expect(await settle({ id: 'o', totalUgx: 0, storeCreditAppliedUgx: 0, paymentStatus: 'unpaid' }).uc.execute('o', 't')).toBe('not_fully_covered');
  });

  it('the order total stays the full sale; the amount due is total less credit', () => {
    const o = new Order('o', 'GP-1', 'C', '+256700000001', undefined, 'Kampala', 'Plot', 'retail' as never, [], 100_000, 0, 100_000, 'unpaid' as never, 'received' as never, new Date(), new Date());
    const credited = o.withStoreCredit(30_000);
    expect(credited.totalUgx).toBe(100_000);
    expect(credited.amountDueUgx).toBe(70_000);
    expect(o.withStoreCredit(500_000).amountDueUgx).toBe(0);
  });

  it('issuing: a second approver above 500,000, a valid phone, the code texted only when spendable', async () => {
    const issued: any[] = []; const texted: any[] = [];
    const repo: any = { issue: async (i: any) => { issued.push(i); return { id: `id${issued.length}` }; } };
    const uc = new IssueCreditUseCase(repo, tools, { send: async (m) => { texted.push(m); } });
    const small = await uc.execute({ kind: 'gift_card', amountUgx: 50_000, reason: 'Sold at the counter', recipientPhone: '0772123456', actorId: 'staff' });
    expect(small).toMatchObject({ ok: true, status: 'active', texted: true });
    expect((small as any).code).toMatch(/^GPGC-/);
    expect(issued[0].codeHash).toBe(`h:${(small as any).code}`);
    expect(issued[0].recipientPhone).toBe('+256772123456');
    expect(texted[0].code).toBe((small as any).code);
    const big = await uc.execute({ kind: 'store_credit', amountUgx: 600_000, reason: 'Refund GP-1', recipientPhone: '0772123456', actorId: 'staff' });
    expect(big).toMatchObject({ ok: true, status: 'pending_approval', texted: false });
    expect(await uc.execute({ kind: 'gift_card', amountUgx: 50_000, reason: 'x', actorId: 'staff' })).toMatchObject({ ok: false, code: 'NEEDS_REASON' });
    expect(await uc.execute({ kind: 'gift_card', amountUgx: 50_000, reason: 'Sold here', recipientPhone: '123', actorId: 'staff' })).toMatchObject({ ok: false, code: 'BAD_PHONE' });
  });

  it('a code check tells the holder the balance or why it cannot pay, nothing else', async () => {
    const code = 'GPGC-' + (await new IssueCreditUseCase({ issue: async () => ({ id: 'x' }) } as any, tools, null).execute({ kind: 'gift_card', amountUgx: 5_000, reason: 'Sold here', actorId: 's' }) as any).code.slice(5);
    const view = (o: any) => ({ id: 'x', kind: 'gift_card', last4: code.slice(-4), status: 'active', balanceUgx: 40_000, expiresAt: null, ...o });
    const m = (o: any) => new ManageCreditUseCases({ findByCodeHash: async () => view(o) } as any, tools);
    expect(await m({}).check(code)).toMatchObject({ ok: true, usable: true, balanceUgx: 40_000, reason: null });
    expect(await m({ status: 'void' }).check(code)).toMatchObject({ ok: true, usable: false, balanceUgx: 0 });
    expect(await m({ balanceUgx: 0 }).check(code)).toMatchObject({ usable: false, reason: 'This card has no balance left.' });
    // Held by an unpaid order is not "no balance": the holder is told where the money is and how to free it.
    expect(await m({ balanceUgx: 0, heldUgx: 30_000 }).check(code)).toMatchObject({ usable: false, reason: expect.stringContaining('UGX 30,000 on this card is reserved for an order that has not been paid yet') });
    expect(await m({}).check('nonsense')).toEqual({ ok: false });
    expect(JSON.stringify(await m({ recipientName: 'Amina' }).check(code))).not.toContain('Amina');
  });

  it('a cancelled order releases its credit with the other holds, isolated from them', async () => {
    const seen: string[] = [];
    await new ReleaseCancelledOrderHoldsUseCase({
      releaseInventory: { execute: async () => { throw new Error('stock down'); } },
      releaseRedemption: { execute: async () => ({ ok: true }) },
      storeCredit: { releaseOrReturnForOrder: async (id) => { seen.push(id); return {}; } },
      onFailed: (hold) => seen.push(`failed:${hold}`),
    }).execute('o9');
    expect(seen).toEqual(['o9', 'failed:inventory']);
  });

  it('Pesapal is asked only for the amount due, never for zero; the paid-amount check compares the amount due', () => {
    const spp = read('apps/api/src/application/use-cases/payments/StartPesaPalPaymentUseCase.ts');
    expect(spp).toContain('amount: amountDue(order),');
    expect(spp).toContain("throw new Error('NOTHING_TO_PAY: Store credit covers this order in full.');");
    expect(read('apps/api/src/infrastructure/Registry.ts')).toContain('if (!order || order.amountDueUgx === paidUgx) return;');
  });

  it('only the code\'s hash leaves the checkout route; a malformed code is refused before any order', () => {
    const route = read('apps/api/src/interfaces/http/routes/commerce.ts');
    expect(route).toContain('storeCreditCodeHash = creditCodeHash(parsedCode.code);');
    expect(route).toMatch(/if \(!parsedCode\) \{\s*return c\.json\(\{ success: false, error: \{ code: 'STORE_CREDIT_UNAVAILABLE'/);
  });

  it('a rider never collects what a gift card already paid', async () => {
    const { riderCollectionAmount } = await import('../../apps/api/src/domain/delivery/DeliveryVariance');
    expect(riderCollectionAmount({ paymentStatus: 'unpaid', totalUgx: 116_500, storeCreditAppliedUgx: 50_000 })).toEqual({ collect: 66_500, label: 'COLLECT ON DELIVERY: UGX 66,500' });
    expect(riderCollectionAmount({ paymentStatus: 'unpaid', totalUgx: 116_500 }).collect).toBe(116_500);
  });

  it('payment messages name the gift card split, and say nothing new when there is none', async () => {
    const { smsText, emailCopy } = await import('../../apps/api/src/application/notifications/CustomerMessages');
    const base = { orderNumber: 'GP-1', totalUgx: 116_500 };
    expect(smsText('ORDER_PAYMENT_SUCCESS', { ...base, storeCreditAppliedUgx: 50_000 } as never)).toContain('(gift card or store credit UGX 50,000 + Mobile Money or card UGX 66,500)');
    expect(smsText('ORDER_PAYMENT_SUCCESS', { ...base, storeCreditAppliedUgx: 116_500 } as never)).toContain('(paid in full with your gift card or store credit)');
    expect(smsText('ORDER_PAYMENT_SUCCESS', base as never)).not.toContain('gift card');
    expect(emailCopy('ORDER_PAYMENT_SUCCESS', { ...base, storeCreditAppliedUgx: 50_000 } as never)?.body).toContain('Mobile Money or card UGX 66,500');
  });

  it('Goldie answers gift card questions from what the shop does, and leaves promo-code questions alone', async () => {
    const { classify, answerDeterministically } = await import('../../apps/web/src/lib/assistantRouter');
    for (const q of ['Do you sell gift cards?', 'can i pay with a gift card', 'I have store credit, how do I use it', 'gift voucher for my brother']) {
      expect(classify(q), q).toMatchObject({ intent: 'PAYMENT', deterministic: true, query: 'gift card' });
    }
    expect(classify('do you have a voucher code').query).not.toBe('gift card');
    expect(classify('can I pay with mobile money').query).not.toBe('gift card');
    const a = await answerDeterministically(classify('Do you sell gift cards?'));
    expect(a.text).toContain('Gift card or store credit');
    expect(a.links.some((l) => l.url.endsWith('/gift-card'))).toBe(true);
  });

  it('points: a cash partial refund takes its share of the WHOLE order, and an item given back to a card takes its share too', async () => {
    const { ApplyRefundConsequencesUseCase } = await import('../../apps/api/src/application/use-cases/payments/ApplyRefundConsequencesUseCase');
    const shares: number[] = [];
    const loyalty = { execute: async (i: { refundedShareBps: number }) => { shares.push(i.refundedShareBps); } };
    const repo = { updatePaymentAttemptStatus: async () => undefined, updateOrderPaymentStatusSafely: async () => undefined } as never;
    const attempt = { id: 'a1', orderId: 'o1', amount: 150_000, orderTrackingId: 't', merchantReference: 'm' };
    const ctx = { actorType: 'admin' as never, source: 'admin' as never, providerConfirmed: false };
    // Order 250,000: card 100,000 + Mobile Money 150,000. 50,000 of the Mobile Money comes back = 20% of the order.
    await new ApplyRefundConsequencesUseCase(repo, {} as never, { getRefundedTotalUgx: async () => 50_000 }, loyalty, undefined, async () => 100_000).execute(attempt, ctx);
    expect(shares).toEqual([2_000]);
    // Without a card the share is unchanged from before (a third of the cash).
    await new ApplyRefundConsequencesUseCase(repo, {} as never, { getRefundedTotalUgx: async () => 50_000 }, loyalty).execute(attempt, ctx);
    expect(shares[1]).toBe(3_333);

    const back: number[] = [];
    // The repository reports everything the order has had back so far (card + cash): the share sent to loyalty is
    // that running total, so a second 25,000 return on a 250,000 order is 20%, not another 10% (2026-10-22).
    let soFar = 0;
    const m = new ManageCreditUseCases({ returnToCardForOrder: async (_r: string, amount: number) => { soFar += amount; return { ok: true, instrumentId: 'c', leftUgx: 50_000, orderId: 'o1', orderTotalUgx: 250_000, refundedSoFarUgx: soFar }; } } as any, tools,
      { execute: async (i) => { back.push(i.refundedShareBps); } });
    expect(await m.returnToCard('gp-202610-abcd', 25_000, 'staff', 'Charger returned')).toMatchObject({ ok: true });
    expect(await m.returnToCard('gp-202610-abcd', 25_000, 'staff', 'Cable returned')).toMatchObject({ ok: true });
    expect(back).toEqual([1_000, 2_000]);
    expect(await m.returnToCard('nonsense', 25_000, 'staff', 'Charger returned')).toMatchObject({ ok: false });
    expect(back).toHaveLength(2);
  });

  it('a cancelled order says where the card money went, and who refunds the rest', async () => {
    const { smsText, emailCopy } = await import('../../apps/api/src/application/notifications/CustomerMessages');
    const base = { orderNumber: 'GP-1', totalUgx: 116_500 };
    const partPaid = smsText('ORDER_CANCELLED_BY_SHOP', { ...base, storeCreditAppliedUgx: 50_000, paymentStatus: 'paid' } as never)!;
    expect(partPaid).toContain('The UGX 50,000 your gift card or store credit paid is back on the card already.');
    expect(partPaid).toContain('If you paid the other UGX 66,500 by Mobile Money or card, our team arranges that refund.');
    const fullCard = smsText('ORDER_CANCELLED_BY_SHOP', { ...base, storeCreditAppliedUgx: 116_500, paymentStatus: 'paid' } as never)!;
    expect(fullCard).toContain('Nothing else was paid, so there is nothing more to refund.');
    expect(fullCard).not.toContain('our team arranges');
    const unpaid = smsText('ORDER_CANCELLED_BY_SHOP', { ...base, storeCreditAppliedUgx: 50_000, paymentStatus: 'unpaid' } as never)!;
    expect(unpaid).toContain('reserved on your gift card or store credit is free to use again');
    expect(smsText('ORDER_CANCELLED_BY_SHOP', base as never)).toContain('If you paid for it, our team arranges the refund.');
    expect(emailCopy('ORDER_CANCELLED_BY_SHOP', { ...base, storeCreditAppliedUgx: 50_000, paymentStatus: 'paid' } as never)?.body).toContain('our team arranges that refund and will contact you');
    const { cancelRefundUpdate } = await import('../../apps/api/src/application/notifications/CustomerMessages');
    expect(cancelRefundUpdate({ ...base, storeCreditAppliedUgx: 116_500, paymentStatus: 'paid' } as never)).toBe('The UGX 116,500 your gift card or store credit paid is back on the card already. Nothing else was paid, so there is nothing more to refund.');
    expect(cancelRefundUpdate(base as never)).toBeNull(); // the designed email keeps its own line
    const { renderEmailTemplate, customerEmailData } = await import('../../apps/api/src/infrastructure/notifications/email/emailTemplateData');
    const html = renderEmailTemplate('ORDER_CANCELLED_BY_SHOP', customerEmailData('ORDER_CANCELLED_BY_SHOP', {
      customerName: 'Amina', orderNumber: 'GP-1', createdAt: new Date().toISOString(), totalUgx: 116_500, deliveryFeeUgx: 0, deliveryLocation: 'Kampala',
      paymentStatus: 'paid', orderUrl: 'https://shopgoldplus.com/track-order', items: [], refundUpdate: cancelRefundUpdate({ ...base, storeCreditAppliedUgx: 50_000, paymentStatus: 'paid' } as never),
    } as never)).html;
    expect(html).toContain('is back on the card already');
    expect(html).not.toContain('If any money was taken');
  });

  it('the accountant export: labelled movements, released holds as 0, and no cell a spreadsheet would run', async () => {
    const realFetch = globalThis.fetch;
    let asked = '';
    globalThis.fetch = (async (u: string) => {
      asked = String(u);
      return new Response(JSON.stringify({ success: true, data: [
        { type: 'ISSUE', amountUgx: 50_000, holdState: null, orderNumber: null, note: '=HYPERLINK("http://evil")', createdAt: '2026-10-20T07:00:00Z', kind: 'gift_card', last4: 'AB12' },
        { type: 'HOLD', amountUgx: -20_000, holdState: 'captured', orderNumber: 'GP-1', note: 'Checkout', createdAt: '2026-10-20T08:00:00Z', kind: 'gift_card', last4: 'AB12' },
        { type: 'HOLD', amountUgx: -5_000, holdState: 'released', orderNumber: 'GP-2', note: 'Checkout, "abandoned"', createdAt: '2026-10-20T09:00:00Z', kind: 'gift_card', last4: 'AB12' },
      ] }), { status: 200 });
    }) as never;
    try {
      const { GET } = await import('../../apps/web/src/pages/admin/credit/ledger.csv');
      const unauth = await GET({ request: new Request('http://x/admin/credit/ledger.csv'), url: new URL('http://x/admin/credit/ledger.csv') } as never);
      expect(unauth.status).toBe(401);
      const res = await GET({ request: new Request('http://x/', { headers: { cookie: 'goldplus_session=t' } }), url: new URL('http://x/admin/credit/ledger.csv?from=2026-10-01&to=2026-10-31') } as never);
      expect(asked).toContain('/admin/credit/ledger?from=2026-10-01&to=2026-10-31');
      expect(res.headers.get('content-type')).toContain('text/csv');
      const rows = (await res.text()).trim().split('\r\n');
      expect(rows[0]).toBe('Date (Kampala),Card,Movement,Amount (UGX),Order,Note');
      expect(rows[1]).toContain(`Gift card ****AB12,Issued,50000,,"'=HYPERLINK(""http://evil"")"`);
      expect(rows[2]).toContain('Spent on an order,-20000,GP-1,Checkout');
      expect(rows[3]).toContain(`Reserved then released,0,GP-2,"Checkout, ""abandoned"""`);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('card used: the holder hears when someone else spent it; the buyer is not texted twice', async () => {
    const { NotifyCardUsedUseCase, CreditExpiryRemindersUseCase } = await import('../../apps/api/src/application/use-cases/credit/CreditUseCases');
    const sent: any[] = [];
    const sender = { send: async (m: any) => { sent.push(m); } };
    const spent = (o: any) => ({ cardSpentOnOrder: async () => ({ instrumentId: 'c1', kind: 'gift_card', last4: 'AB12', recipientPhone: '+256772111222', balanceUgx: 60_000, spentUgx: 40_000, orderNumber: 'GP-1', orderPhone: '+256700000001', ...o }) });
    expect(await new NotifyCardUsedUseCase(spent({}) as any, sender).execute('o1')).toBe('sent');
    expect(sent[0]).toMatchObject({ template: 'CREDIT_USED', phone: '+256772111222', idempotencyKey: 'credit-used:o1' });
    expect(await new NotifyCardUsedUseCase(spent({ orderPhone: '0772111222' }) as any, sender).execute('o2')).toBe('skipped'); // same person
    expect(await new NotifyCardUsedUseCase(spent({ recipientPhone: null }) as any, sender).execute('o3')).toBe('skipped');
    expect(sent).toHaveLength(1);

    const { smsText } = await import('../../apps/api/src/application/notifications/CustomerMessages');
    const used = smsText('CREDIT_USED', sent[0].data)!;
    expect(used).toBe('GoldPlus: UGX 40,000 from your gift card ending AB12 paid for order GP-1. Left on it: UGX 60,000. Not you? Call 0705 004545.');
    expect(used).not.toMatch(/GPGC-/); // never the code

    const reminders: any[] = [];
    const r = await new CreditExpiryRemindersUseCase({ expiringSoon: async () => [
      { instrumentId: 'c9', kind: 'store_credit', last4: 'ZZ99', phone: '+256772000999', expiresAt: new Date('2026-10-27T20:59:59Z'), balanceUgx: 12_000 },
    ] } as any, { send: async (m: any) => { reminders.push(m); } }).execute(new Date('2026-10-20T10:00:00Z'));
    expect(r).toEqual({ due: 1, sent: 1 });
    expect(reminders[0].idempotencyKey).toBe('credit-expiring:c9'); // once per card, however often the ticker runs
    expect(smsText('CREDIT_EXPIRING', reminders[0].data)).toContain('store credit ending ZZ99 has UGX 12,000 left and ends on 27 October 2026');
  });

  it('issuing for an order fills the customer and links the account; an unknown order is refused', async () => {
    const issued: any[] = [];
    const repo: any = {
      orderForCredit: async (ref: string) => (ref === 'GP-202610-ABCD' ? { id: 'o1', userId: 'u1', name: 'Amina N', phone: '+256772123456' } : null),
      issue: async (i: any) => { issued.push(i); return { id: 'c1' }; },
    };
    const texts: any[] = [];
    const uc = new IssueCreditUseCase(repo, tools, { send: async (m) => { texts.push(m); } });
    expect(await uc.execute({ kind: 'store_credit', amountUgx: 30_000, reason: 'Refund for GP-202610-ABCD', orderNumber: 'gp-202610-abcd', actorId: 's' })).toMatchObject({ ok: true, texted: true });
    expect(issued[0]).toMatchObject({ sourceOrderId: 'o1', customerUserId: 'u1', recipientName: 'Amina N', recipientPhone: '+256772123456' });
    expect(texts[0]).toMatchObject({ phone: '+256772123456', recipientName: 'Amina N' });
    expect(await uc.execute({ kind: 'store_credit', amountUgx: 30_000, reason: 'Refund', orderNumber: 'GP-NOPE', actorId: 's' })).toMatchObject({ ok: false, code: 'BAD_ORDER' });
  });

  it('a refund as store credit takes back the order\'s points by its running refunded share (2026-10-22)', async () => {
    const shares: number[] = [];
    const repo: any = {
      orderForCredit: async () => ({ id: 'o1', userId: 'u1', name: 'Amina N', phone: '+256772123456' }),
      issue: async () => ({ id: 'c1' }),
      refundedSoFarForOrder: async () => ({ refundedUgx: 30_000, totalUgx: 120_000 }),
    };
    const uc = new IssueCreditUseCase(repo, tools, null, { execute: async (i) => { shares.push(i.refundedShareBps); } });
    await uc.execute({ kind: 'store_credit', amountUgx: 30_000, reason: 'Refund for GP-202610-ABCD', orderNumber: 'GP-202610-ABCD', actorId: 's' });
    expect(shares).toEqual([2_500]);
    // A credit not linked to an order (a gift sold at the counter) touches no loyalty.
    await uc.execute({ kind: 'gift_card', amountUgx: 30_000, reason: 'Sold at the counter', actorId: 's' });
    expect(shares).toEqual([2_500]);
  });
});
