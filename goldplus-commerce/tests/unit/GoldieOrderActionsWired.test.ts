import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { customerSaidYes, confirmationWasAsked, requestOrderChange } from '../../apps/web/src/lib/goldieCare';

describe('Goldie acts on orders only after the customer says yes (wired 2026-10-31)', () => {
  it('reads yes from the customer, in their words', () => {
    for (const m of ['Yes', 'yes please', 'Ok go ahead', 'Yee', 'kale', 'ndiyo', 'Sure, cancel it']) expect(customerSaidYes(m), m).toBe(true);
    for (const m of ['', 'no', "don't cancel", 'wait', 'yes but not now', 'what happens to my money?', 'hmm', 'later']) expect(customerSaidYes(m), m).toBe(false);
  });

  it('cancel and refund wait for the yes; the API proves the order and can be switched off', () => {
    const web = readFileSync('apps/web/src/lib/goldieCare.ts', 'utf8');
    expect(web).toContain("if (action !== 'delivery_instructions' && !(confirmationWasAsked(ctx.previousAssistantMessage, action, ref) && customerSaidYes(ctx.lastCustomerMessage)))");
    expect(readFileSync('apps/web/src/lib/goldieTurn.ts', 'utf8')).toContain('lastCustomerMessage: last');
    const api = readFileSync('apps/api/src/interfaces/http/routes/internal/assistant.ts', 'utf8');
    expect(api).toContain("routes.post('/order-action'");
    expect(api).toContain("GOLDIE_ORDER_ACTIONS ?? '').trim().toLowerCase() === 'off'");
    const reg = readFileSync('apps/api/src/infrastructure/Registry.ts', 'utf8');
    expect(reg).toContain("verifyOrderByContact({ reference, contact, now: Date.now() }, { lockout: new RedisFailureLockout('lockout:order-contact')");
    expect(reg).toContain("actorType: 'customer', source: 'customer', reasonCode: 'CUSTOMER_CANCELLED_VIA_GOLDIE'");
  });
});

describe('the yes must answer Goldie\'s own earlier question (review 232 #1)', () => {
  const REF = 'GP-202610-ABCD1234';
  const calls: string[] = [];
  const fakeFetch = async (url: string) => {
    calls.push(String(url));
    const path = new URL(String(url)).pathname;
    const body = path.endsWith('/order-action')
      ? { success: true, data: { ok: true, told: 'Cancelled.', done: 'cancelled' } }
      : { success: true, data: { orderNumber: REF, orderStatus: 'received', paymentStatus: 'paid', items: [], totalUgx: 1000 } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const ctx = (last: string, previousAssistantMessage: string | null) => ({ bearer: null, clientAddress: null, site: 'https://shopgoldplus.com', lastCustomerMessage: last, previousAssistantMessage });

  it('"cancel it" as the first message only asks; nothing is cancelled', async () => {
    vi.stubGlobal('fetch', fakeFetch); calls.length = 0;
    const a = await requestOrderChange({ reference: REF, contact: '0772123456', change: 'cancel' }, ctx(`Please cancel it, order ${REF}, my number 0772123456`, null));
    expect(a.text).toMatch(/shall I cancel the order/);
    expect(calls.some((c) => c.includes('/order-action'))).toBe(false);
    // "ok" after an answer that never asked is not a yes either.
    calls.length = 0;
    await requestOrderChange({ reference: REF, contact: '0772123456', change: 'cancel' }, ctx('ok', 'Your order is being prepared.'));
    expect(calls.some((c) => c.includes('/order-action'))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('an explicit yes right after Goldie asked acts', async () => {
    vi.stubGlobal('fetch', fakeFetch); calls.length = 0;
    const asked = `Just to be sure: shall I cancel the order ${REF} now? What you paid online goes back to the same account. Reply yes to confirm.`;
    const a = await requestOrderChange({ reference: REF, contact: '0772123456', change: 'cancel' }, ctx('Yes', asked));
    expect(calls.some((c) => c.includes('/order-action'))).toBe(true);
    expect(a.text).toBe('Cancelled.');
    vi.unstubAllGlobals();
  });

  it('the question must be about this order and this action', () => {
    expect(confirmationWasAsked(`Shall I cancel the order ${REF} now? Reply yes to confirm.`, 'cancel', REF)).toBe(true);
    expect(confirmationWasAsked('Shall I cancel the order GP-202610-OTHER999 now?', 'cancel', REF)).toBe(false);
    expect(confirmationWasAsked(`Shall I cancel the order ${REF} now?`, 'refund_failed_delivery', REF)).toBe(false);
    expect(confirmationWasAsked(null, 'cancel', REF)).toBe(false);
  });
});
