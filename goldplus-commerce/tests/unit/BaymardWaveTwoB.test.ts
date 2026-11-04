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

// ── A3: sign in with the phone and a code by SMS ─────────────────────────────
import { createHash } from 'node:crypto';
import {
  RequestSmsSignInCodeUseCase, SignInWithSmsCodeUseCase, GENERIC_SMS_SIGN_IN_ACKNOWLEDGEMENT, SMS_SIGN_IN_MAX_ATTEMPTS, signInCodeHash,
} from '../../apps/api/src/application/use-cases/identity/SmsSignInUseCases';
import { resetCodeHash } from '../../apps/api/src/application/use-cases/identity/SmsPasswordResetUseCases';
import { ChangeEmailUseCase } from '../../apps/api/src/application/use-cases/identity/ChangeEmailUseCase';
import { smsText, emailCopy } from '../../apps/api/src/application/notifications/CustomerMessages';
import { stageDates, formatStepDate, riderLine } from '../../apps/web/src/lib/orderProgress';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const USER = { id: 'u-1', email: 'x@example.com', phone: '0772123456', passwordHash: 'hashed:pw', isActive: true, createdAt: new Date() };
const E164 = '+256772123456';
const T0 = new Date('2026-11-04T10:00:00Z');
interface OtpRow { id: string; userId: string; phoneE164: string; codeHash: string; attempts: number; expiresAt: Date; consumedAt: Date | null; createdAt: Date }

function smsHarness(opts: { user?: typeof USER | null; issued?: OtpRow[] } = {}) {
  let now = T0;
  const rows: OtpRow[] = [...(opts.issued ?? [])];
  const sent: Array<{ phoneE164: string; code: string }> = [];
  const verified: string[] = [];
  const users = { async findByPhone(e164: string) { const u = opts.user === undefined ? USER : opts.user; return u && e164 === E164 ? u : null; } };
  const identity = {
    async createOtp(i: { userId: string; phoneE164: string; codeHash: string; expiresAt: Date }) { rows.push({ id: `otp-${rows.length + 1}`, attempts: 0, consumedAt: null, createdAt: now, ...i }); },
    async lastOtpIssuedAt(userId: string) { const mine = rows.filter((r) => r.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); return mine[0]?.createdAt ?? null; },
    async otpCountSince(userId: string, since: Date, purpose?: string) { return rows.filter((r) => r.userId === userId && r.createdAt >= since && (purpose !== 'signin' || r.codeHash.startsWith('sgn:'))).length; },
    // The real repository filters by marker; the fake does the same so a reset code can never be read as a sign-in code.
    async latestOtp(userId: string, purpose?: string) { const mine = rows.filter((r) => r.userId === userId && !r.consumedAt && (purpose === 'signin' ? r.codeHash.startsWith('sgn:') : true)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); return mine[0] ?? null; },
    async bumpOtpAttempts(id: string) { const r = rows.find((x) => x.id === id)!; r.attempts += 1; return r.attempts; },
    async consumeOtp(id: string) { rows.find((x) => x.id === id)!.consumedAt = now; },
    async markPhoneVerified(userId: string, phoneE164: string) { verified.push(`${userId}:${phoneE164}`); },
  };
  const delivery = { async sendSignInCode(i: { phoneE164: string; code: string }) { sent.push({ phoneE164: i.phoneE164, code: i.code }); return { status: 'SENT' as const }; } };
  const signer = { isConfigured: () => true, sign: async (p: { subject: string }) => `token-for-${p.subject}`, verify: async () => null };
  let nextCode = '123456';
  const clock = () => now;
  return {
    request: new RequestSmsSignInCodeUseCase(users, identity, delivery, sha, () => nextCode, clock),
    verify: new SignInWithSmsCodeUseCase(users, identity, signer, sha, clock),
    rows, sent, verified, setCode: (c: string) => { nextCode = c; }, advance: (ms: number) => { now = new Date(now.getTime() + ms); },
  };
}

describe('Baymard wave 2b — A3: sign in with the phone and a code by SMS', () => {
  it('answers the same sentence for a number with an account, one without, and a malformed one (no enumeration)', async () => {
    const h = smsHarness();
    const a = await h.request.execute({ phone: '0772123456' });
    const b = await h.request.execute({ phone: '0700000000' });
    const c = await h.request.execute({ phone: 'nope' });
    expect([a.message, b.message, c.message]).toEqual([GENERIC_SMS_SIGN_IN_ACKNOWLEDGEMENT, GENERIC_SMS_SIGN_IN_ACKNOWLEDGEMENT, GENERIC_SMS_SIGN_IN_ACKNOWLEDGEMENT]);
    expect(h.sent).toEqual([{ phoneE164: E164, code: '123456' }]);
    // Stored hashed and marked; never the code.
    expect(h.rows[0].codeHash.startsWith('sgn:')).toBe(true);
    expect(h.rows[0].codeHash).not.toContain('123456');
  });

  it('the right code signs in, marks the phone verified, works once, and mints an ordinary session token', async () => {
    const h = smsHarness();
    await h.request.execute({ phone: '0772123456' });
    const r = await h.verify.execute({ phone: '+256 772 123 456', code: '123 456' });
    expect(r).toMatchObject({ ok: true, token: 'token-for-u-1', user: { id: 'u-1', email: 'x@example.com' } });
    expect(h.verified).toEqual(['u-1:+256772123456']);
    const again = await h.verify.execute({ phone: '0772123456', code: '123456' });
    expect(again).toMatchObject({ ok: false, code: 'CODE_INVALID' });
  });

  it('a password reset code can never sign anyone in (domain separation), and five wrong guesses lock the code', async () => {
    const h = smsHarness({ issued: [{ id: 'rst', userId: 'u-1', phoneE164: E164, codeHash: resetCodeHash(sha, '999999'), attempts: 0, expiresAt: new Date(T0.getTime() + 600_000), consumedAt: null, createdAt: T0 }] });
    expect(await h.verify.execute({ phone: '0772123456', code: '999999' })).toMatchObject({ ok: false, code: 'CODE_INVALID' });
    await h.request.execute({ phone: '0772123456' });
    for (let i = 0; i < SMS_SIGN_IN_MAX_ATTEMPTS; i++) expect((await h.verify.execute({ phone: '0772123456', code: '000000' })).ok).toBe(false);
    expect(await h.verify.execute({ phone: '0772123456', code: '123456' })).toMatchObject({ ok: false, code: 'TOO_MANY_ATTEMPTS' });
    expect(signInCodeHash(sha, '123456')).not.toBe(resetCodeHash(sha, '123456'));
  });

  it('an expired code is refused and the resend cooldown holds', async () => {
    const h = smsHarness();
    await h.request.execute({ phone: '0772123456' });
    const second = await h.request.execute({ phone: '0772123456' });
    expect(second.internal.throttled).toBe(true);
    h.advance(11 * 60_000);
    expect(await h.verify.execute({ phone: '0772123456', code: '123456' })).toMatchObject({ ok: false, code: 'CODE_INVALID' });
  });

  it('has its own SMS wording and no email form; the login page offers it first, with the password form kept', () => {
    expect(smsText('SIGN_IN_CODE', { code: '123456', expiresInMinutes: 10 })).toContain('sign-in code is 123456');
    expect(emailCopy('SIGN_IN_CODE', { code: '123456' })).toBeNull();
    const login = src('apps/web/src/pages/login.astro');
    expect(login).toContain('/auth/sms-sign-in/start');
    expect(login).toContain('/auth/sms-sign-in/verify');
    expect(login).toContain('<input type="hidden" name="intent" value="sms-start" />');
    expect(login).toContain('autocomplete="one-time-code"');
    expect(login).toContain('<FormField id="email" name="email" label="Email"');
    // One completion path for both ways in (cookies, saved items, visit-token rotation, returnTo).
    expect(login).toContain('const completeSignIn = async (data: any): Promise<Response> =>');
    expect(login.match(/return await completeSignIn\(json\.data\)/g)?.length).toBe(2);
    const auth = src('apps/api/src/interfaces/http/routes/auth.ts');
    expect(auth).toContain("routes.post('/sms-sign-in/start'");
    expect(auth).toContain("routes.post('/sms-sign-in/verify'");
  });
});

// ── A6: dated steps and rider details ────────────────────────────────────────
describe('Baymard wave 2b — A6: the tracking ladder has dates and says who has the parcel', () => {
  it('maps the API facts onto the four stages and words the rider line for a customer', () => {
    const t = { placedAt: '2026-11-04T06:00:00Z', confirmedAt: '2026-11-04T07:30:00Z', dispatchedAt: null, deliveredAt: null, rider: { name: 'Moses', carrier: null, method: 'rider', estimatedDeliveryAt: null } };
    expect(stageDates(t)).toEqual(['2026-11-04T06:00:00Z', '2026-11-04T07:30:00Z', null, null]);
    expect(stageDates(null)).toEqual([null, null, null, null]);
    expect(formatStepDate('2026-11-04T07:30:00Z')).toBe('4 Nov, 10:30'); // Kampala time
    expect(formatStepDate(null)).toBe('');
    expect(riderLine(t)).toBe('With our rider Moses');
    expect(riderLine({ rider: { name: null, carrier: 'Link Bus', method: 'bus', estimatedDeliveryAt: null } })).toBe('Sent by Link Bus');
    expect(riderLine({ rider: null })).toBe('');
  });

  it('both ladders render the step date and the rider line; the API gives only the first name', () => {
    for (const p of ['apps/web/src/pages/track-order.astro', 'apps/web/src/pages/orders/[id].astro']) {
      const page = src(p);
      expect(page).toContain('formatStepDate(stageDates(order.tracking)[i])');
      expect(page).toContain('riderLine(order.tracking)');
    }
    const repo = src('apps/api/src/infrastructure/db/repositories/DrizzleOrderRepository.ts');
    expect(repo).toMatch(/trackingFacts[\s\S]*?firstName\(dispatch\.riderName\)/);
    expect(repo).toMatch(/eq\(orderEvents\.isSynthetic, false\)/);
    expect(src('apps/api/src/interfaces/http/routes/commerce.ts')).toContain('tracking: await registry.orderTrackingUseCase.execute(order.id)');
  });
});

// ── A8: your details ─────────────────────────────────────────────────────────
describe('Baymard wave 2b — A8: email and phone are editable', () => {
  function emailHarness(user: Partial<typeof USER> | null = USER) {
    const updates: string[] = [];
    const failures: Date[] = [];
    const users = {
      findById: async () => (user ? { ...USER, ...user } : null),
      findByEmail: async (e: string) => (e === 'taken@example.com' ? { ...USER, id: 'other' } : null),
      updateEmail: async (id: string, e: string) => { updates.push(`${id}:${e}`); },
    } as any;
    const hasher = { hash: async (p: string) => `hashed:${p}`, verify: async (p: string, h: string) => h === `hashed:${p}` };
    const attempts = { getFailures: async () => failures, addFailure: async (_k: string, at: Date) => { failures.push(at); }, clear: async () => { failures.length = 0; } };
    return { uc: new ChangeEmailUseCase(users, hasher, attempts), updates, failures };
  }

  it('changes the email only with the current password, lower-cased, and refuses a taken or unchanged one', async () => {
    const h = emailHarness();
    expect(await h.uc.execute({ userId: 'u-1', newEmail: 'New@Example.com', currentPassword: 'pw' })).toMatchObject({ ok: true, email: 'new@example.com' });
    expect(h.updates).toEqual(['u-1:new@example.com']);
    expect(await h.uc.execute({ userId: 'u-1', newEmail: 'x@example.com', currentPassword: 'pw' })).toMatchObject({ ok: false, code: 'SAME_EMAIL' });
    expect(await h.uc.execute({ userId: 'u-1', newEmail: 'taken@example.com', currentPassword: 'pw' })).toMatchObject({ ok: false, code: 'EMAIL_TAKEN' });
    expect(await h.uc.execute({ userId: 'u-1', newEmail: 'ok@example.com', currentPassword: 'wrong' })).toMatchObject({ ok: false, code: 'WRONG_PASSWORD' });
    expect(h.failures.length).toBe(1);
    expect(await h.uc.execute({ userId: 'u-1', newEmail: 'not-an-email', currentPassword: 'pw' })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
  });

  it('a social-only account (no password) is told how to set one; the page and route exist and the phone goes through the code flow', async () => {
    expect(await emailHarness({ passwordHash: null as any }).uc.execute({ userId: 'u-1', newEmail: 'ok@example.com', currentPassword: 'pw' })).toMatchObject({ ok: false, code: 'NO_PASSWORD_SET' });
    const page = src('apps/web/src/pages/account/profile.astro');
    expect(page).toContain("authedSend('PUT', '/account/email'");
    expect(page).toContain("'/account/phone/request-verification'");
    expect(page).toContain("'/account/phone/verify'");
    expect(src('apps/api/src/interfaces/http/routes/account.ts')).toContain("routes.put('/email'");
    expect(src('apps/web/src/components/AccountNav.astro')).toContain("href: '/account/profile'");
  });
});
