import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { customerSaidYes } from '../../apps/web/src/lib/goldieCare';

describe('Goldie acts on orders only after the customer says yes (wired 2026-10-31)', () => {
  it('reads yes from the customer, in their words', () => {
    for (const m of ['Yes', 'yes please', 'Ok go ahead', 'Yee', 'kale', 'ndiyo', 'Sure, cancel it']) expect(customerSaidYes(m), m).toBe(true);
    for (const m of ['', 'no', "don't cancel", 'wait', 'yes but not now', 'what happens to my money?', 'hmm', 'later']) expect(customerSaidYes(m), m).toBe(false);
  });

  it('cancel and refund wait for the yes; the API proves the order and can be switched off', () => {
    const web = readFileSync('apps/web/src/lib/goldieCare.ts', 'utf8');
    expect(web).toContain("if (action !== 'delivery_instructions' && !customerSaidYes(ctx.lastCustomerMessage))");
    expect(readFileSync('apps/web/src/lib/goldieTurn.ts', 'utf8')).toContain('lastCustomerMessage: last');
    const api = readFileSync('apps/api/src/interfaces/http/routes/internal/assistant.ts', 'utf8');
    expect(api).toContain("routes.post('/order-action'");
    expect(api).toContain("GOLDIE_ORDER_ACTIONS ?? '').trim().toLowerCase() === 'off'");
    const reg = readFileSync('apps/api/src/infrastructure/Registry.ts', 'utf8');
    expect(reg).toContain("verifyOrderByContact({ reference, contact, now: Date.now() }, { lockout: new RedisFailureLockout('lockout:order-contact')");
    expect(reg).toContain("actorType: 'customer', source: 'customer', reasonCode: 'CUSTOMER_CANCELLED_VIA_GOLDIE'");
  });
});
