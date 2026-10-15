import { describe, expect, it, vi } from 'vitest';
import { AuthenticateUserUseCase } from '../../apps/api/src/application/use-cases/identity/AuthenticateUserUseCase';
import { InMemoryLoginAttemptStore } from '../../apps/api/src/infrastructure/security/InMemoryLoginAttemptStore';
import { ACCOUNT_LOCK_POLICY } from '../../apps/api/src/domain/identity/LoginThrottle';

/**
 * Owner, 2026-10-15: one account guessed from many IPs is paused, without letting an attacker lock the owner out.
 * The (email, ip) lock stays; on top, 20 failures for the account from anywhere in 15 minutes pause sign-in from
 * places the account has not signed in from before. A place it signed in from (30 days) is never held.
 */
function harness() {
  const user = { id: 'u1', email: 'owner@goldplus.com', phone: null, passwordHash: 'hash', isActive: true, createdAt: new Date() };
  const users: any = { findByEmail: vi.fn().mockResolvedValue(user), findById: vi.fn(), create: vi.fn() };
  const hasher: any = { hash: vi.fn().mockResolvedValue('dummy'), verify: vi.fn(async (pw: string) => pw === 'right') };
  const signer: any = { isConfigured: () => true, sign: vi.fn().mockResolvedValue('jwt'), verify: vi.fn() };
  const store = new InMemoryLoginAttemptStore();
  const uc = new AuthenticateUserUseCase(users, hasher, signer, store);
  const login = (ip: string, password: string) => uc.execute({ email: 'owner@goldplus.com', password, ip });
  return { login, store };
}

describe('account-wide sign-in lock', () => {
  it('20 wrong passwords spread over many IPs pause sign-in from a new place', async () => {
    const { login } = harness();
    for (let i = 0; i < ACCOUNT_LOCK_POLICY.maxFailures; i++) {
      // Four per IP: never enough for the per-IP lock (5) to fire.
      expect((await login(`10.0.${Math.floor(i / 4)}.1`, 'wrong')).ok).toBe(false);
    }
    const r = await login('10.9.9.9', 'right');
    expect(r).toMatchObject({ ok: false, code: 'LOCKED' });
  });

  it('the owner at a place they signed in from before is not held by it', async () => {
    const { login } = harness();
    expect((await login('41.210.1.1', 'right')).ok).toBe(true); // the owner's usual place, remembered
    for (let i = 0; i < ACCOUNT_LOCK_POLICY.maxFailures; i++) await login(`10.1.${Math.floor(i / 4)}.1`, 'wrong');
    expect((await login('10.9.9.9', 'right')).ok).toBe(false); // the attacker's new place is paused...
    expect((await login('41.210.1.1', 'right')).ok).toBe(true); // ...the owner's is not
  });

  it('a successful sign-in clears the account count', async () => {
    const { login } = harness();
    for (let i = 0; i < ACCOUNT_LOCK_POLICY.maxFailures - 1; i++) await login(`10.2.${Math.floor(i / 4)}.1`, 'wrong');
    expect((await login('10.3.0.1', 'right')).ok).toBe(true);
    for (let i = 0; i < ACCOUNT_LOCK_POLICY.maxFailures - 1; i++) await login(`10.4.${Math.floor(i / 4)}.1`, 'wrong');
    expect((await login('10.5.0.1', 'right')).ok).toBe(true);
  });

  it('the per-IP lock still holds even at a known place', async () => {
    const { login } = harness();
    expect((await login('41.210.1.1', 'right')).ok).toBe(true);
    for (let i = 0; i < 5; i++) await login('41.210.1.1', 'wrong');
    expect(await login('41.210.1.1', 'right')).toMatchObject({ ok: false, code: 'LOCKED' });
  });

  it('an address that could not be determined is never a known place', async () => {
    const { login } = harness();
    const { UNKNOWN_CLIENT_IP } = await import('../../apps/api/src/domain/identity/ClientAddress');
    expect((await login(UNKNOWN_CLIENT_IP, 'right')).ok).toBe(true);
    for (let i = 0; i < ACCOUNT_LOCK_POLICY.maxFailures; i++) await login(`10.6.${Math.floor(i / 4)}.1`, 'wrong');
    expect(await login(UNKNOWN_CLIENT_IP, 'right')).toMatchObject({ ok: false, code: 'LOCKED' });
  });
});
