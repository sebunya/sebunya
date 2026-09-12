import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyOrderByContact, CONTACT_LOCKOUT_MAX_FAILURES, CONTACT_LOCKOUT_WINDOW_MS } from '../../apps/api/src/application/services/OrderContactVerification';
import { MemoryFailureLockout } from '../../apps/api/src/application/ports/FailureLockoutStore';

const order = { id: 'o1', orderNumber: 'GP-202609-ABCD', customerEmail: 'Robert@Example.com', customerPhone: '+256 705 004545' };
const deps = (found: typeof order | null = order) => ({ lockout: new MemoryFailureLockout(), findOrder: async () => found });
const run = (reference: unknown, contact: unknown, d = deps(), now = 1_000_000) =>
  verifyOrderByContact({ reference, contact, now }, d);

describe('verifyOrderByContact — the one proof a guest has', () => {
  it('refuses wrong types, empties, over-long values and demo drafts with a 400, before touching the store', async () => {
    for (const [r, c] of [[12, 'x'], ['GP-1', 42], ['', 'a@b.c'], ['GP-1', ''], ['x'.repeat(81), 'a@b.c'], ['GP-1', 'y'.repeat(121)], ['GP-DRAFT-1234', 'a@b.c']] as const) {
      const res = await run(r, c, { lockout: new MemoryFailureLockout(), findOrder: async () => { throw new Error('must not be called'); } });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(400);
    }
  });

  it('matches the checkout email case-insensitively and the phone ignoring spaces', async () => {
    expect((await run('GP-202609-ABCD', 'robert@example.COM')).ok).toBe(true);
    expect((await run('GP-202609-ABCD', '+256705004545')).ok).toBe(true);
    expect((await run('GP-202609-ABCD', '+256 705 00 45 45')).ok).toBe(true);
  });

  it('an unknown order and a wrong contact are the same 401, and both count as a failure', async () => {
    const d = deps(null);
    const a = await run('GP-NOPE', 'a@b.c', d);
    expect(a).toMatchObject({ ok: false, status: 401, code: 'VERIFICATION_FAILED' });
    const d2 = deps();
    const b = await run('GP-202609-ABCD', 'someone@else.com', d2);
    expect(b).toMatchObject({ ok: false, status: 401, code: 'VERIFICATION_FAILED' });
    expect(d.lockout.size).toBe(1);
    expect(d2.lockout.size).toBe(1);
  });

  it(`locks the reference after ${CONTACT_LOCKOUT_MAX_FAILURES} failures, whoever sends them, and only that reference`, async () => {
    const d = deps();
    for (let i = 0; i < CONTACT_LOCKOUT_MAX_FAILURES; i++) expect((await run('GP-202609-ABCD', 'wrong@x.y', d)).ok).toBe(false);
    const locked = await run('GP-202609-ABCD', '+256705004545', d); // even the RIGHT contact is refused now
    expect(locked).toMatchObject({ ok: false, status: 429, code: 'TOO_MANY_REQUESTS' });
    const otherReference = await run('gp-202609-abcd ', '+256705004545', d); // case/whitespace do not make a new key
    expect(otherReference).toMatchObject({ ok: false, status: 429 });
    const unrelated = await run('GP-202609-ZZZZ', '+256705004545', d);
    expect(unrelated.ok).toBe(true);
  });

  it('the key does not depend on the client address — the API sees a different Cloudflare edge address per request', () => {
    const src = readFileSync(resolve(__dirname, '../../apps/api/src/application/services/OrderContactVerification.ts'), 'utf8');
    expect(src).toMatch(/createHash\('sha256'\)\.update\(reference\.toUpperCase\(\)\)/);
    expect(src).not.toMatch(/input\.ip/);
  });

  it('the lockout expires with the window, and a success clears it', async () => {
    const d = deps();
    for (let i = 0; i < CONTACT_LOCKOUT_MAX_FAILURES; i++) await run('GP-202609-ABCD', 'wrong@x.y', d);
    expect((await run('GP-202609-ABCD', '+256705004545', d, 1_000_000 + CONTACT_LOCKOUT_WINDOW_MS + 1)).ok).toBe(true);
    expect(d.lockout.size).toBe(0);
  });
});

describe('the routes use the one proof', () => {
  const src = readFileSync(resolve(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'), 'utf8');
  it('lookup and pay-by-reference both go through verifyOrderRequest', () => {
    const lookup = src.slice(src.indexOf("routes.post('/orders/lookup', async"), src.indexOf("routes.post('/orders/lookup', async") + 600);
    const pay = src.slice(src.indexOf("routes.post('/orders/lookup/pay', async"), src.indexOf("routes.post('/orders/lookup/pay', async") + 900);
    expect(lookup).toMatch(/verifyOrderRequest\(c\)/);
    expect(pay).toMatch(/verifyOrderRequest\(c\)/);
  });
  it('pay-by-reference starts payment with the principal RECORDED at checkout, never one the caller supplies', () => {
    const pay = src.slice(src.indexOf("routes.post('/orders/lookup/pay', async"), src.indexOf("routes.post('/orders/lookup/pay', async") + 1200);
    expect(pay).toMatch(/checkoutIdempotencyRepo\.findByOrderId\(verified\.order\.id\)/);
    expect(pay).toMatch(/principalKey: checkout\.principalKey/);
    expect(pay).not.toMatch(/principalKey: body/);
    expect(pay).toMatch(/startOrderPaymentUseCase\.execute/);
  });
  it('both start doors answer through one responder', () => {
    expect((src.match(/respondToStartOutcome\(c, outcome, traceId\)/g) ?? []).length).toBe(2);
  });
});
