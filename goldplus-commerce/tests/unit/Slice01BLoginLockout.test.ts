import { describe, it, expect } from 'vitest';
import {
  evaluateLoginLock,
  loginThrottleKey,
  LOGIN_LOCK_POLICY,
} from '../../apps/api/src/domain/identity/LoginThrottle';
import { AuthenticateUserUseCase } from '../../apps/api/src/application/use-cases/identity/AuthenticateUserUseCase';
import { ILoginAttemptStore } from '../../apps/api/src/application/ports/ILoginAttemptStore';

const now = new Date('2026-07-15T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000);

describe('Login throttle domain (Slice 1B, pure)', () => {
  it('locks after 5 failures inside the 15-minute window and reports retry time', () => {
    const failures = [1, 2, 3, 4, 5].map((m) => minutesAgo(m));
    const state = evaluateLoginLock(failures, now);
    expect(state.locked).toBe(true);
    expect(state.failuresInWindow).toBe(5);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
    expect(state.retryAfterSeconds).toBeLessThanOrEqual(LOGIN_LOCK_POLICY.lockMinutes * 60);
  });

  it('ignores failures outside the window and unlocks after the lock expires', () => {
    const stale = [20, 25, 30, 40, 50].map((m) => minutesAgo(m));
    expect(evaluateLoginLock(stale, now).locked).toBe(false);
    const expired = [16, 17, 18, 19, 20].map((m) => minutesAgo(m));
    // Newest failure 16 minutes ago -> 15-minute lock already elapsed.
    expect(evaluateLoginLock(expired, now).locked).toBe(false);
  });

  it('keys by lowercased email and ip', () => {
    expect(loginThrottleKey('  User@Example.COM ', '1.2.3.4')).toBe('user@example.com|1.2.3.4');
    expect(loginThrottleKey('a@b.c', '')).toBe('a@b.c|ip-unknown');
  });
});

// ---------- use case integration with fakes ----------

function fakeStore(): ILoginAttemptStore & { map: Map<string, Date[]> } {
  const map = new Map<string, Date[]>();
  return {
    map,
    async getFailures(key) { return map.get(key) ?? []; },
    async addFailure(key, at) { map.set(key, [...(map.get(key) ?? []), at]); },
    async clear(key) { map.delete(key); },
  };
}

const hasher = {
  async hash(p: string) { return `hashed:${p}`; },
  async verify(p: string, stored: string) { return stored === `hashed:${p}`; },
};
const signer = {
  isConfigured: () => true,
  async sign() { return 'jwt-token'; },
  async verify() { return null as any; },
};
const users = (known: Record<string, { id: string; passwordHash: string; isActive: boolean }>) => ({
  async findByEmail(email: string) {
    const u = known[email];
    return u ? { id: u.id, email, phone: null, passwordHash: u.passwordHash, isActive: u.isActive } : null;
  },
}) as any;

describe('AuthenticateUserUseCase lockout (Slice 1B)', () => {
  const goodUser = { 'user@example.com': { id: 'u1', passwordHash: 'hashed:correct', isActive: true } };

  it('locks the email+ip pair after repeated failures, even with the right password', async () => {
    const store = fakeStore();
    const uc = new AuthenticateUserUseCase(users(goodUser), hasher as any, signer as any, store);
    for (let i = 0; i < 5; i++) {
      const r = await uc.execute({ email: 'user@example.com', password: 'wrong', ip: '1.1.1.1' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('INVALID_CREDENTIALS');
    }
    const locked = await uc.execute({ email: 'user@example.com', password: 'correct', ip: '1.1.1.1' });
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.code).toBe('LOCKED');
      expect(locked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it('scopes the lock to the ip — another ip can still sign in', async () => {
    const store = fakeStore();
    const uc = new AuthenticateUserUseCase(users(goodUser), hasher as any, signer as any, store);
    for (let i = 0; i < 5; i++) await uc.execute({ email: 'user@example.com', password: 'wrong', ip: '1.1.1.1' });
    const other = await uc.execute({ email: 'user@example.com', password: 'correct', ip: '2.2.2.2' });
    expect(other.ok).toBe(true);
  });

  it('clears the counter on success', async () => {
    const store = fakeStore();
    const uc = new AuthenticateUserUseCase(users(goodUser), hasher as any, signer as any, store);
    for (let i = 0; i < 4; i++) await uc.execute({ email: 'user@example.com', password: 'wrong', ip: '1.1.1.1' });
    const ok = await uc.execute({ email: 'user@example.com', password: 'correct', ip: '1.1.1.1' });
    expect(ok.ok).toBe(true);
    expect(store.map.size).toBe(0);
  });

  it('records failures for unknown emails too and keeps the generic message', async () => {
    const store = fakeStore();
    const uc = new AuthenticateUserUseCase(users({}), hasher as any, signer as any, store);
    const r = await uc.execute({ email: 'ghost@example.com', password: 'x', ip: '1.1.1.1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe('Email or password is incorrect.');
    expect([...store.map.keys()]).toEqual(['ghost@example.com|1.1.1.1']);
  });

  it('remains fully backwards-compatible without a store', async () => {
    const uc = new AuthenticateUserUseCase(users(goodUser), hasher as any, signer as any);
    const ok = await uc.execute({ email: 'user@example.com', password: 'correct' });
    expect(ok.ok).toBe(true);
  });
});
