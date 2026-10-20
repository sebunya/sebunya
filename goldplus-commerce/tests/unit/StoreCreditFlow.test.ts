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
});
