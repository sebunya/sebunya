import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ClaimOrderUseCase, type ClaimOutcome } from '../../apps/api/src/application/use-cases/orders/ClaimOrderUseCase';
import { MemoryFailureLockout } from '../../apps/api/src/application/ports/FailureLockoutStore';

const src = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');
const order = { id: 'o1', orderNumber: 'GP-202611-ABCD', customerEmail: 'a@b.co', customerPhone: '+256705004545' };

function uc(outcome: ClaimOutcome, calls: string[] = []) {
  return new ClaimOrderUseCase(
    { claimForUser: async (orderId, userId) => { calls.push(`${orderId}:${userId}`); return outcome; } },
    new MemoryFailureLockout(),
    async (ref) => (ref === order.orderNumber ? order : null),
  );
}

describe('Baymard wave 2b — A1: the account offered after the order keeps the order', () => {
  it('claims only with the order proof (number + the contact on the order), never from the user id alone', async () => {
    const calls: string[] = [];
    const u = uc('claimed', calls);
    const wrong = await u.execute({ userId: 'u1', reference: order.orderNumber, contact: '+256700000000' });
    expect(wrong).toMatchObject({ ok: false, status: 401, code: 'VERIFICATION_FAILED' });
    expect(calls).toEqual([]);
    const right = await u.execute({ userId: 'u1', reference: order.orderNumber, contact: 'A@B.co' });
    expect(right).toMatchObject({ ok: true, outcome: 'claimed', orderId: 'o1', orderNumber: order.orderNumber });
    expect(calls).toEqual(['o1:u1']);
  });

  it("never moves an order that belongs to another account, and says so", async () => {
    const r = await uc('taken').execute({ userId: 'u2', reference: order.orderNumber, contact: order.customerPhone });
    expect(r).toMatchObject({ ok: false, status: 409, code: 'ORDER_TAKEN' });
  });

  it('is idempotent: claiming your own order again is ok', async () => {
    const r = await uc('already_yours').execute({ userId: 'u1', reference: order.orderNumber, contact: order.customerPhone });
    expect(r).toMatchObject({ ok: true, outcome: 'already_yours' });
  });

  it('the repository only ever sets a NULL user_id (SQL guard), and the route is on the signed-in account router', () => {
    const repo = src('apps/api/src/infrastructure/db/repositories/DrizzleOrderRepository.ts');
    expect(repo).toMatch(/claimForUser[\s\S]*?\$\{orders\.userId\} is null/);
    const account = src('apps/api/src/interfaces/http/routes/account.ts');
    expect(account).toContain("routes.use('*', customerSessionMiddleware)");
    expect(account).toContain("routes.post('/orders/claim'");
    expect(account).toContain("new RedisFailureLockout('lockout:order-contact')");
  });

  it('registration itself still never claims orders (the exception lives in the claim use case only)', () => {
    const reg = src('apps/api/src/application/use-cases/identity/RegisterCustomerUseCase.ts');
    expect(reg).not.toMatch(/claimForUser|orders\.userId/);
  });

  it('the confirmation page asks for one field, prefills the contact from checkout memory and posts the claim', () => {
    const page = src('apps/web/src/pages/checkout/confirmed.astro');
    expect(page).toContain('Keep this order in a free account');
    expect(page).toMatch(/<FormField id="join-password" name="password" label="Choose a password"/);
    expect(page).toContain("readGuestMemory(Astro.cookies, Astro.request)");
    expect(page).toContain("postJson('/account/orders/claim', { reference, contact }, token");
    expect(page).toContain("fetch(`${apiBase}/auth/register`");
    // A guest who already has an account is sent to sign in and comes back here, where the claim happens silently.
    expect(page).toMatch(/\/login\?returnTo=\$\{encodeURIComponent\(confirmedPath\)\}/);
    expect(page).toContain('checkRequestOrigin(Astro.request');
  });
});

describe('Baymard wave 2b — A11: a receipt without an account', () => {
  it('/receipt proves the order the way tracking does and shows a receipt for paid orders only', () => {
    const page = src('apps/web/src/pages/receipt.astro');
    expect(page).toContain("postJson('/commerce/orders/lookup', { reference, contact }, null, readClientAddress(Astro))");
    expect(page).toContain("order?.paymentStatus === 'paid'");
    expect(page).toContain('It is not a URA EFRIS e-invoice');
    expect(page).toContain('robotsMeta="noindex,nofollow"');
    // Figures are the API's; the arithmetic lines show only when they add up exactly.
    expect(page).toMatch(/addsUp = Boolean\(order &&/);
  });

  it('is rate-limited like /track-order and linked from the confirmation and tracking pages', () => {
    expect(src('apps/web/src/lib/publicFormLimiter.ts')).toContain("'/receipt': { limit: 20, windowMs: TEN_MINUTES }");
    expect(src('apps/web/src/pages/checkout/confirmed.astro')).toContain('Get a receipt for this order');
    const track = src('apps/web/src/pages/track-order.astro');
    expect(track).toMatch(/order\.paymentStatus === 'paid' && \([\s\S]*?action="\/receipt"/);
  });
});
