import { describe, expect, it, vi } from 'vitest';
import {
  ChangePasswordUseCase,
  passwordChangeThrottleKey,
} from '../../apps/api/src/application/use-cases/identity/ChangePasswordUseCase';
import { LOGIN_LOCK_POLICY } from '../../apps/api/src/domain/identity/LoginThrottle';

/** A hasher whose "hash" is visible, so the assertions read as what they mean. */
const hasher = {
  hash: async (p: string) => `hashed:${p}`,
  verify: async (p: string, stored: string) => stored === `hashed:${p}`,
};

function world(over: { passwordHash?: string | null; isActive?: boolean; exists?: boolean } = {}) {
  const failures = new Map<string, Date[]>();
  const attempts = {
    getFailures: async (k: string) => failures.get(k) ?? [],
    addFailure: async (k: string, at: Date) => { failures.set(k, [...(failures.get(k) ?? []), at]); },
    clear: async (k: string) => { failures.delete(k); },
  };
  const user = over.exists === false ? null : {
    id: 'u1', email: 'a@b.com', phone: null, isActive: over.isActive ?? true, createdAt: new Date(),
    passwordHash: over.passwordHash === undefined ? 'hashed:old-password' : over.passwordHash,
  };
  const users = { findById: vi.fn(async () => user) } as never;
  const passwords = { setPasswordAndRevoke: vi.fn(async () => undefined) };
  let now = new Date('2026-09-30T09:00:00.000Z');
  const uc = new ChangePasswordUseCase(users, hasher, passwords, attempts, () => now);
  return { uc, passwords, failures, tick: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

const input = (over: Record<string, unknown> = {}) => ({ userId: 'u1', currentPassword: 'old-password', newPassword: 'new-password-1', ...over });

describe('a signed-in customer changes their password', () => {
  it('writes the new hash and revokes sessions in one repository call', async () => {
    const w = world();
    expect(await w.uc.execute(input())).toEqual({ ok: true, userId: 'u1' });
    expect(w.passwords.setPasswordAndRevoke).toHaveBeenCalledWith('u1', 'hashed:new-password-1');
  });

  it('a session alone is not enough: the current password must be right', async () => {
    const w = world();
    const out = await w.uc.execute(input({ currentPassword: 'guess' }));
    expect(out).toMatchObject({ ok: false, code: 'WRONG_PASSWORD' });
    expect(w.passwords.setPasswordAndRevoke).not.toHaveBeenCalled();
  });

  it('locks after five wrong current passwords, even for the right one, and unlocks after the lock period', async () => {
    const w = world();
    for (let i = 0; i < LOGIN_LOCK_POLICY.maxFailures; i += 1) {
      expect((await w.uc.execute(input({ currentPassword: `guess-${i}` })))).toMatchObject({ code: 'WRONG_PASSWORD' });
    }
    const locked = await w.uc.execute(input());
    expect(locked).toMatchObject({ ok: false, code: 'LOCKED' });
    expect((locked as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0);
    expect(w.passwords.setPasswordAndRevoke).not.toHaveBeenCalled();
    w.tick((LOGIN_LOCK_POLICY.lockMinutes + 1) * 60_000);
    expect(await w.uc.execute(input())).toEqual({ ok: true, userId: 'u1' });
  });

  it('a success clears earlier wrong attempts', async () => {
    const w = world();
    await w.uc.execute(input({ currentPassword: 'guess' }));
    await w.uc.execute(input());
    expect(w.failures.has(passwordChangeThrottleKey('u1'))).toBe(false);
  });

  it('refuses a short, over-long, missing or unchanged new password without counting a failure', async () => {
    const w = world();
    expect(await w.uc.execute(input({ newPassword: 'short' }))).toMatchObject({ code: 'WEAK_PASSWORD' });
    expect(await w.uc.execute(input({ newPassword: 'x'.repeat(201) }))).toMatchObject({ code: 'WEAK_PASSWORD' });
    expect(await w.uc.execute(input({ newPassword: undefined }))).toMatchObject({ code: 'BAD_INPUT' });
    expect(await w.uc.execute(input({ currentPassword: 12345678 }))).toMatchObject({ code: 'BAD_INPUT' });
    expect(await w.uc.execute(input({ newPassword: 'old-password' }))).toMatchObject({ code: 'SAME_PASSWORD' });
    expect(w.failures.size).toBe(0);
    expect(w.passwords.setPasswordAndRevoke).not.toHaveBeenCalled();
  });

  it('an account with no password cannot set one here, and a disabled or missing account is refused', async () => {
    expect(await world({ passwordHash: null }).uc.execute(input())).toMatchObject({ code: 'NO_PASSWORD_SET' });
    expect(await world({ isActive: false }).uc.execute(input())).toMatchObject({ code: 'ACCOUNT_UNAVAILABLE' });
    expect(await world({ exists: false }).uc.execute(input())).toMatchObject({ code: 'ACCOUNT_UNAVAILABLE' });
  });
});
