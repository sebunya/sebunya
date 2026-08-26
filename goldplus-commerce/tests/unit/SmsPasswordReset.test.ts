import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  RequestSmsPasswordResetUseCase,
  ResetPasswordWithSmsCodeUseCase,
  GENERIC_SMS_RESET_ACKNOWLEDGEMENT,
  SMS_RESET_MAX_ATTEMPTS,
  resetCodeHash,
} from '../../apps/api/src/application/use-cases/identity/SmsPasswordResetUseCases';
import { smsText, whatsappText, emailCopy } from '../../apps/api/src/application/notifications/CustomerMessages';
import { classifyTemplate } from '../../apps/api/src/infrastructure/notifications/messageClassification';

/**
 * Password reset by SMS code: the only recovery channel that reaches a
 * GoldPlus customer today. These pin the rules that make it safe to expose
 * anonymously: no enumeration, nothing decryptable stored, one code space
 * that cannot be confused with phone verification, bounded guessing, and a
 * reset that revokes every session.
 */

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const USER = { id: 'u-1', email: 'x@example.com', phone: '0772123456', passwordHash: 'old', isActive: true, createdAt: new Date() };
const E164 = '+256772123456';
const T0 = new Date('2026-08-26T10:00:00Z');

interface OtpRow { id: string; userId: string; phoneE164: string; codeHash: string; attempts: number; expiresAt: Date; consumedAt: Date | null; createdAt: Date }

function harness(opts: { user?: typeof USER | null; issued?: OtpRow[]; send?: 'SENT' | 'FAILED' } = {}) {
  let now = T0;
  const rows: OtpRow[] = [...(opts.issued ?? [])];
  const sent: Array<{ phoneE164: string; code: string }> = [];
  const verified: string[] = [];
  const passwords: Array<{ userId: string; newPasswordHash: string }> = [];
  const users = {
    async findByPhone(e164: string) {
      const u = opts.user === undefined ? USER : opts.user;
      return u && e164 === E164 ? u : null;
    },
  };
  const identity = {
    async createOtp(i: { userId: string; phoneE164: string; codeHash: string; expiresAt: Date }) {
      rows.push({ id: `otp-${rows.length + 1}`, attempts: 0, consumedAt: null, createdAt: now, ...i });
    },
    async lastOtpIssuedAt(userId: string) {
      const mine = rows.filter((r) => r.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return mine[0]?.createdAt ?? null;
    },
    async otpCountSince(userId: string, since: Date) {
      return rows.filter((r) => r.userId === userId && r.createdAt >= since).length;
    },
    async latestOtp(userId: string) {
      const mine = rows.filter((r) => r.userId === userId && !r.consumedAt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return mine[0] ?? null;
    },
    async bumpOtpAttempts(id: string) {
      const r = rows.find((x) => x.id === id)!;
      r.attempts += 1;
      return r.attempts;
    },
    async consumeOtp(id: string) {
      rows.find((x) => x.id === id)!.consumedAt = now;
    },
    async markPhoneVerified(userId: string, phoneE164: string) {
      verified.push(`${userId}:${phoneE164}`);
    },
  };
  const delivery = {
    async sendResetCode(i: { phoneE164: string; code: string; expiresInMinutes: number }) {
      sent.push({ phoneE164: i.phoneE164, code: i.code });
      return { status: opts.send ?? ('SENT' as const) };
    },
  };
  const recovery = {
    async setPasswordAndRevokeSessions(i: { userId: string; newPasswordHash: string }) {
      passwords.push(i);
      return true;
    },
  };
  const hasher = { hash: async (p: string) => `hashed:${p}`, verify: async () => true };
  let nextCode = '123456';
  const clock = () => now;
  const request = new RequestSmsPasswordResetUseCase(users, identity, delivery, sha, () => nextCode, clock);
  const reset = new ResetPasswordWithSmsCodeUseCase(users, identity, recovery, hasher, sha, clock);
  return {
    request,
    reset,
    rows,
    sent,
    verified,
    passwords,
    setCode: (c: string) => { nextCode = c; },
    advance: (ms: number) => { now = new Date(now.getTime() + ms); },
  };
}

describe('requesting a reset code by SMS', () => {
  it('answers identically for an unknown number, a known number and a throttled number', async () => {
    const h = harness();
    const unknown = await h.request.execute({ phone: '0700000000' });
    const known = await h.request.execute({ phone: '0772 123 456' });
    const again = await h.request.execute({ phone: '0772123456' }); // inside the cooldown
    expect(unknown.message).toBe(GENERIC_SMS_RESET_ACKNOWLEDGEMENT);
    expect(known.message).toBe(GENERIC_SMS_RESET_ACKNOWLEDGEMENT);
    expect(again.message).toBe(GENERIC_SMS_RESET_ACKNOWLEDGEMENT);
    expect(unknown.internal.userFound).toBe(false);
    expect(known.internal.delivery).toBe('SENT');
    expect(again.internal.throttled).toBe(true);
    // exactly one SMS, to the E.164 form of the number the account holds
    expect(h.sent).toEqual([{ phoneE164: E164, code: '123456' }]);
  });

  it('sends nothing for a number with no account, and nothing for an inactive account', async () => {
    const none = harness({ user: null });
    await none.request.execute({ phone: '0772123456' });
    expect(none.sent).toHaveLength(0);
    expect(none.rows).toHaveLength(0);
    const inactive = harness({ user: { ...USER, isActive: false } });
    await inactive.request.execute({ phone: '0772123456' });
    expect(inactive.sent).toHaveLength(0);
  });

  it('persists only a hash, and a DIFFERENT hash from the phone verification code space', async () => {
    const h = harness();
    await h.request.execute({ phone: '0772123456' });
    const stored = h.rows[0].codeHash;
    expect(stored).not.toContain('123456');
    expect(stored).not.toBe(sha('123456')); // a verification code hashed the usual way must not match
    expect(stored).toBe(resetCodeHash(sha, '123456'));
    // Nothing but the phone itself may carry those digits: the row holds a hash, never the code.
    expect(JSON.stringify({ ...h.rows[0], phoneE164: '' })).not.toContain('123456');
  });

  it('caps issuing at the hourly limit without invalidating the code the customer already has', async () => {
    const issued: OtpRow[] = [];
    for (let i = 0; i < 5; i += 1) {
      issued.push({ id: `old-${i}`, userId: 'u-1', phoneE164: E164, codeHash: 'x', attempts: 0, consumedAt: null, expiresAt: new Date(T0.getTime() + 600_000), createdAt: new Date(T0.getTime() - (i + 2) * 120_000) });
    }
    const capped = harness({ issued });
    const r = await capped.request.execute({ phone: '0772123456' });
    expect(r.internal.throttled).toBe(true);
    expect(capped.sent).toHaveLength(0);
    expect(capped.rows).toHaveLength(5);
  });

  it('allows another code once the cooldown has passed', async () => {
    const h = harness();
    await h.request.execute({ phone: '0772123456' });
    h.advance(61_000);
    h.setCode('654321');
    const r = await h.request.execute({ phone: '0772123456' });
    expect(r.internal.throttled).toBe(false);
    expect(h.sent.map((s) => s.code)).toEqual(['123456', '654321']);
  });
});

describe('resetting with the SMS code', () => {
  it('sets the password, consumes the code, revokes sessions and marks the phone verified', async () => {
    const h = harness();
    await h.request.execute({ phone: '0772123456' });
    const r = await h.reset.execute({ phone: '+256 772 123456', code: '123 456', newPassword: 'correct horse' });
    expect(r).toEqual({ ok: true, userId: 'u-1' });
    expect(h.passwords).toEqual([{ userId: 'u-1', newPasswordHash: 'hashed:correct horse' }]);
    expect(h.rows[0].consumedAt).not.toBeNull();
    expect(h.verified).toEqual([`u-1:${E164}`]);
  });

  it('gives ONE answer for a wrong code, an unknown number, no code outstanding, an expired code and a used code', async () => {
    const h = harness();
    await h.request.execute({ phone: '0772123456' });
    const wrong = await h.reset.execute({ phone: '0772123456', code: '000000', newPassword: 'correct horse' });
    const unknown = await h.reset.execute({ phone: '0700000000', code: '123456', newPassword: 'correct horse' });

    const fresh = harness();
    const none = await fresh.reset.execute({ phone: '0772123456', code: '123456', newPassword: 'correct horse' });

    const late = harness();
    await late.request.execute({ phone: '0772123456' });
    late.advance(11 * 60_000);
    const expired = await late.reset.execute({ phone: '0772123456', code: '123456', newPassword: 'correct horse' });

    const twice = harness();
    await twice.request.execute({ phone: '0772123456' });
    const first = await twice.reset.execute({ phone: '0772123456', code: '123456', newPassword: 'correct horse' });
    expect(first.ok).toBe(true);
    const used = await twice.reset.execute({ phone: '0772123456', code: '123456', newPassword: 'another horse' });

    for (const r of [wrong, unknown, none, expired, used]) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('CODE_INVALID');
        expect(r.message).toBe(wrong.ok ? '' : wrong.message);
        expect(r.message).not.toMatch(/[–—]/);
      }
    }
    expect(h.passwords).toHaveLength(0);
    expect(twice.passwords).toHaveLength(1);
  });

  it('refuses a weak password BEFORE spending a guess', async () => {
    const h = harness();
    await h.request.execute({ phone: '0772123456' });
    const r = await h.reset.execute({ phone: '0772123456', code: '123456', newPassword: 'short' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('WEAK_PASSWORD');
    expect(h.rows[0].attempts).toBe(0);
  });

  it('locks the code after five wrong guesses, and the right code no longer works', async () => {
    const h = harness();
    await h.request.execute({ phone: '0772123456' });
    for (let i = 0; i < SMS_RESET_MAX_ATTEMPTS; i += 1) {
      const r = await h.reset.execute({ phone: '0772123456', code: '999999', newPassword: 'correct horse' });
      expect(r.ok).toBe(false);
    }
    const sixth = await h.reset.execute({ phone: '0772123456', code: '123456', newPassword: 'correct horse' });
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.code).toBe('TOO_MANY_ATTEMPTS');
    expect(h.passwords).toHaveLength(0);
  });

  it('a phone verification code can never reset a password', async () => {
    const h = harness({
      issued: [{ id: 'v-1', userId: 'u-1', phoneE164: E164, codeHash: sha('123456'), attempts: 0, consumedAt: null, expiresAt: new Date(T0.getTime() + 9 * 60_000), createdAt: new Date(T0.getTime() - 60_000) }],
    });
    const r = await h.reset.execute({ phone: '0772123456', code: '123456', newPassword: 'correct horse' });
    expect(r.ok).toBe(false);
    expect(h.passwords).toHaveLength(0);
  });

  it('a code sent to one number cannot be redeemed with another', async () => {
    const h = harness();
    await h.request.execute({ phone: '0772123456' });
    h.rows[0].phoneE164 = '+256700000001'; // the row belongs to a different number
    const r = await h.reset.execute({ phone: '0772123456', code: '123456', newPassword: 'correct horse' });
    expect(r.ok).toBe(false);
  });
});

describe('the reset code message', () => {
  it('has SMS and WhatsApp wording, no email form, is transactional and carries no dash', () => {
    const sms = smsText('PASSWORD_RESET_CODE', { code: '123456', expiresInMinutes: 10 })!;
    expect(sms).toContain('123456');
    expect(sms).toMatch(/10 minutes/);
    expect(sms).toMatch(/ignore/i);
    expect(sms).not.toMatch(/[–—]/);
    expect(whatsappText('PASSWORD_RESET_CODE', { code: '123456' })).toContain('123456');
    expect(emailCopy('PASSWORD_RESET_CODE', { code: '123456' })).toBeNull();
    expect(smsText('PASSWORD_RESET_CODE', {})).toBeNull();
    expect(classifyTemplate('PASSWORD_RESET_CODE')).toBe('TRANSACTIONAL');
  });
});
