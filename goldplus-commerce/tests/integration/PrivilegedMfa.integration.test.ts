import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Slice 3C — privileged MFA on a REAL PostgreSQL. Proves enrolment→confirm with
 * a genuine TOTP code, one-time recovery codes that are single-use, step-up
 * freshness, the self-bypass-denial gate, and that the secret is encrypted at
 * rest (a raw DB read never yields a working factor).
 *
 * Set AUTH_TEST_DATABASE_URL to a MIGRATED database. Skips visibly otherwise.
 */
const URL = process.env.AUTH_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('privileged MFA + step-up (real PostgreSQL)', () => {
  let service: any;
  let totp: any;
  let raw: any;
  const userIds: string[] = [];

  const freshUser = async (): Promise<string> => {
    const email = `mfa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}@example.com`;
    const [row] = await raw`insert into users (email, password_hash) values (${email}, 'x') returning id`;
    userIds.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    // The auth database is built from the schema snapshot only: layer 0187 (idempotent) as other suites do.
    const sqlText = (await import('node:fs')).readFileSync('apps/api/src/infrastructure/db/migrations/0187_auth_session_step_ups.sql', 'utf8')
      .replace(/--> statement-breakpoint/g, '').replace(/SET LOCAL[^;]*;/g, '');
    await raw.unsafe(sqlText);

    const repoMod = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleMfaRepository');
    const svcMod = await import('../../apps/api/src/infrastructure/security/MfaService');
    totp = await import('../../apps/api/src/infrastructure/security/TotpService');
    service = new svcMod.MfaService(new repoMod.DrizzleMfaRepository());
  });

  afterAll(async () => {
    if (raw && userIds.length) {
      await raw`delete from user_mfa_recovery_codes where user_id = any(${userIds})`;
      await raw`delete from user_mfa where user_id = any(${userIds})`;
      await raw`delete from users where id = any(${userIds})`;
      await raw.end();
    }
  });

  it('enrols, confirms with a real code, and gates on step-up freshness', async () => {
    const userId = await freshUser();
    const start = await service.beginEnrolment(userId, 'admin@example.com');
    expect(start.otpauthUri).toContain('otpauth://totp/');

    // A privileged action before confirmation must demand enrolment/step-up.
    expect((await service.gate(userId, 'release_approval')).action).not.toBe('ALLOW');

    const now = new Date();
    const code = totp.totp(start.secret, now.getTime());
    const confirmed = await service.confirmEnrolment(userId, code, now);
    expect(confirmed.ok).toBe(true);
    expect(confirmed.recoveryCodes).toHaveLength(10);

    // Freshly confirmed => a privileged action is allowed.
    expect((await service.gate(userId, 'release_approval', now)).action).toBe('ALLOW');
    // Six minutes later the proof is stale => step-up required again.
    const later = new Date(now.getTime() + 6 * 60_000);
    expect((await service.gate(userId, 'release_approval', later)).action).toBe('STEP_UP_REQUIRED');
  });

  it('rejects a wrong code and stores the secret only encrypted', async () => {
    const userId = await freshUser();
    const start = await service.beginEnrolment(userId, 'a@b.com');
    expect(await service.verify(userId, '000000')).toBe(false); // not confirmed yet, wrong anyway

    const [row] = await raw`select secret_ciphertext from user_mfa where user_id = ${userId}`;
    expect(row.secret_ciphertext).not.toContain(start.secret); // encrypted at rest
    expect(row.secret_ciphertext.length).toBeGreaterThan(20);
  });

  it('makes each recovery code single-use', async () => {
    const userId = await freshUser();
    const start = await service.beginEnrolment(userId, 'a@b.com');
    const now = new Date();
    const { recoveryCodes } = await service.confirmEnrolment(userId, totp.totp(start.secret, now.getTime()), now);

    const code = recoveryCodes[0];
    expect(await service.useRecoveryCode(userId, code)).toBe(true);
    // Second use of the same code fails.
    expect(await service.useRecoveryCode(userId, code)).toBe(false);
    // A different code still works.
    expect(await service.useRecoveryCode(userId, recoveryCodes[1])).toBe(true);
  });

  it('replacing a confirmed authenticator needs a current code, never just a fresh step-up', async () => {
    const userId = await freshUser();
    const start = await service.beginEnrolment(userId, 'a@b.com');
    const t0 = new Date();
    const { recoveryCodes } = await service.confirmEnrolment(userId, totp.totp(start.secret, t0.getTime()), t0);
    // Freshly confirmed (step-up is fresh), but a token holder with no code cannot swap the authenticator.
    expect(await service.beginEnrolment(userId, 'a@b.com', undefined, t0)).toEqual({ currentCodeRequired: true });
    expect(await service.beginEnrolment(userId, 'a@b.com', { code: '000000' }, t0)).toEqual({ currentCodeInvalid: true });
    const [kept] = await raw`select confirmed_at from user_mfa where user_id = ${userId}`;
    expect(kept.confirmed_at).not.toBeNull(); // the live authenticator is untouched

    // With a code from the current authenticator (a later step), it is replaced.
    const later = new Date(t0.getTime() + 2 * 60_000);
    const replaced = await service.beginEnrolment(userId, 'a@b.com', { code: totp.totp(start.secret, later.getTime()) }, later);
    expect('secret' in replaced && replaced.secret).not.toBe(start.secret);

    // A lost phone: a recovery code works too (after confirming the new one).
    const next = replaced as { secret: string };
    const t1 = new Date(later.getTime() + 60_000);
    const { recoveryCodes: fresh } = await service.confirmEnrolment(userId, totp.totp(next.secret, t1.getTime()), t1);
    // The old recovery codes were replaced on the new confirmation, so an old one is refused...
    expect(await service.beginEnrolment(userId, 'a@b.com', { code: recoveryCodes?.[0] ?? '', recovery: true }, t1)).toEqual({ currentCodeInvalid: true });
    // ...and a current one replaces the authenticator.
    const t2 = new Date(t1.getTime() + 60_000);
    const viaRecovery = await service.beginEnrolment(userId, 'a@b.com', { code: fresh?.[0] ?? '', recovery: true }, t2);
    expect('secret' in viaRecovery).toBe(true);
  });

  it("a verification counts for the session it was made in, never another session's (0187)", async () => {
    const userId = await freshUser();
    const start = await service.beginEnrolment(userId, 'a@b.com');
    const t0 = new Date();
    await service.confirmEnrolment(userId, totp.totp(start.secret, t0.getTime()), t0);
    const { randomUUID } = await import('node:crypto');
    const adminSession = randomUUID(); const stolenSession = randomUUID();
    const t1 = new Date(t0.getTime() + 10 * 60_000); // the confirmation has gone stale
    expect(await service.verify(userId, totp.totp(start.secret, t1.getTime()), t1, adminSession)).toBe(true);
    // The admin's own session is open...
    expect((await service.gate(userId, 'payment_refund', t1, adminSession)).action).toBe('ALLOW');
    // ...a stolen token's session is not, though the ACCOUNT verified a moment ago.
    expect((await service.gate(userId, 'payment_refund', t1, stolenSession)).action).toBe('STEP_UP_REQUIRED');
    expect((await service.status(userId, stolenSession)).lastVerifiedAt).toBeNull();
    // Stored to the second (the db client drops milliseconds), plenty for a five-minute window.
    expect(Math.abs(((await service.status(userId, adminSession)).lastVerifiedAt?.getTime() ?? 0) - t1.getTime())).toBeLessThan(1000);
    // A token issued without a session (store down) keeps the account-wide rule, so it is never stuck.
    expect((await service.gate(userId, 'payment_refund', t1, null)).action).toBe('ALLOW');
    await raw`delete from auth_session_step_ups where user_id = ${userId}`;
  });

  it('a code that was already accepted cannot be used again inside its window', async () => {
    const userId = await freshUser();
    const start = await service.beginEnrolment(userId, 'a@b.com');
    const t0 = new Date();
    await service.confirmEnrolment(userId, totp.totp(start.secret, t0.getTime()), t0);
    const t1 = new Date(t0.getTime() + 5 * 60_000);
    const code = totp.totp(start.secret, t1.getTime());
    expect(await service.verify(userId, code, t1)).toBe(true);
    // The same code, 20 seconds later, is still inside its window: refused as a replay.
    expect(await service.verify(userId, code, new Date(t1.getTime() + 20_000))).toBe(false);
    // A new code a few minutes later is accepted.
    const t2 = new Date(t1.getTime() + 3 * 60_000);
    expect(await service.verify(userId, totp.totp(start.secret, t2.getTime()), t2)).toBe(true);
  });

  it('a successful TOTP verify refreshes step-up; disable clears everything', async () => {
    const userId = await freshUser();
    const start = await service.beginEnrolment(userId, 'a@b.com');
    const t0 = new Date();
    await service.confirmEnrolment(userId, totp.totp(start.secret, t0.getTime()), t0);

    // Let it go stale, then re-verify to refresh.
    const stale = new Date(t0.getTime() + 6 * 60_000);
    expect((await service.gate(userId, 'pricing_approval', stale)).action).toBe('STEP_UP_REQUIRED');
    const ok = await service.verify(userId, totp.totp(start.secret, stale.getTime()), stale);
    expect(ok).toBe(true);
    expect((await service.gate(userId, 'pricing_approval', stale)).action).toBe('ALLOW');

    await service.disable(userId);
    const status = await service.status(userId);
    expect(status.enrolled).toBe(false);
    const [{ count }] = await raw`select count(*)::int as count from user_mfa_recovery_codes where user_id = ${userId}`;
    expect(count).toBe(0);
  });
});
