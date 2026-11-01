import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// hono lives in the API workspace; the root test run cannot resolve the bare name.
import { Hono } from '../../apps/api/node_modules/hono/dist/index.js';

const liveSession = vi.hoisted(() => ({ result: null as unknown }));
vi.mock('../../apps/api/src/interfaces/http/middleware/liveSession', () => ({
  resolveLiveSession: async () => liveSession.result,
}));

import { optionalCustomerSessionMiddleware } from '../../apps/api/src/interfaces/http/middleware/customerSession';
import { classifyPublicEndpoint } from '../../apps/api/src/domain/security/PublicEndpointPolicy';
import { RedisFailureLockout } from '../../apps/api/src/infrastructure/security/RedisFailureLockout';
import { sessionCutoffAt, isInvalidatedByCutoff } from '../../apps/api/src/domain/identity/SessionPolicy';
import { Hs256TokenSigner } from '../../apps/api/src/infrastructure/security/Hs256TokenSigner';
import { ResetPasswordUseCase } from '../../apps/api/src/application/use-cases/identity/PasswordResetUseCases';
import { ResetPasswordWithSmsCodeUseCase } from '../../apps/api/src/application/use-cases/identity/SmsPasswordResetUseCases';
import { InMemoryLoginAttemptStore, MAX_REMEMBERED } from '../../apps/api/src/infrastructure/security/InMemoryLoginAttemptStore';

const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const handler = (src: string, start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start) + 1));

describe('SEO connector: discover and select-resource carry the same guards as PATCH', () => {
  const src = read('apps/api/src/interfaces/http/routes/admin/seo-integrations.ts');
  for (const [start, end] of [
    ["routes.post('/connections/:id/discover'", 'routes.post('],
    ["routes.post('/connections/:id/select-resource'", 'routes.post('],
  ]) {
    it(start, () => {
      const body = handler(src, start, end);
      expect(body).toMatch(/requireCustomConnectorRight\(c, connection\.provider_id\)/);
      expect(body).toMatch(/connection\.status === 'DISABLED'/);
      // The guard comes before anything is written or any provider is called.
      expect(body.indexOf('requireCustomConnectorRight')).toBeLessThan(
        Math.max(body.indexOf('updateConnection'), body.indexOf('tryConsumeUsage')),
      );
    });
  }
});

describe('registration and social exchange have their own auth budget', () => {
  it('classifies them out of the global family', () => {
    expect(classifyPublicEndpoint('POST', '/auth/register')).toBe('auth-customer-login');
    expect(classifyPublicEndpoint('POST', '/auth/social/google/exchange')).toBe('auth-customer-login');
    expect(classifyPublicEndpoint('POST', '/AUTH/Social/facebook/exchange/')).toBe('auth-customer-login');
    expect(classifyPublicEndpoint('GET', '/auth/social/google/start')).toBe('global');
  });
});

describe('social unlink locks the account row before counting sign-in methods', () => {
  it('SELECT ... FOR UPDATE on users precedes the guard and the delete', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleSocialIdentityRepository.ts');
    const unlink = src.slice(src.indexOf('async unlink('));
    const lock = unlink.indexOf('from users where id = ${userId}::uuid for update');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(unlink.indexOf('as has_password'));
    expect(lock).toBeLessThan(unlink.indexOf('delete from user_identities'));
  });
});

describe('optional customer session: an expired token is anonymous, a revoked one is refused', () => {
  const app = new Hono();
  app.get('/x', optionalCustomerSessionMiddleware as never, (c: any) => c.json({ userId: c.get('userId') ?? null }));
  const call = () => app.request('/x', { headers: { Authorization: 'Bearer t' } });

  beforeEach(() => {
    liveSession.result = null;
  });

  it('expired or unreadable: through as anonymous', async () => {
    liveSession.result = { ok: false, code: 'UNAUTHENTICATED', message: 'Invalid or expired session.' };
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: null });
  });

  it('revoked: 401', async () => {
    liveSession.result = { ok: false, code: 'UNAUTHENTICATED', message: 'revoked', revoked: true };
    expect((await call()).status).toBe(401);
  });

  it('disabled: 403', async () => {
    liveSession.result = { ok: false, code: 'ACCOUNT_DISABLED', message: 'disabled' };
    expect((await call()).status).toBe(403);
  });

  it('valid: the user is set', async () => {
    liveSession.result = { ok: true, user: { id: 'u1', email: 'a@b', isActive: true, sessionId: null } };
    expect(await (await call()).json()).toEqual({ userId: 'u1' });
  });
});

describe('Redis failure lockout: the counter and its expiry are one atomic step', () => {
  it('records a failure with one EVAL that sets a TTL whenever the key has none', async () => {
    const calls: unknown[][] = [];
    const store = new RedisFailureLockout('p', 'redis://unused');
    (store as any).client = {
      eval: async (...args: unknown[]) => {
        calls.push(args);
        return 1;
      },
      incr: async () => { throw new Error('INCR must not be sent on its own'); },
      pexpire: async () => { throw new Error('PEXPIRE must not be sent on its own'); },
    };
    await store.recordFailure('phone', Date.now(), 60_000);
    expect(calls).toHaveLength(1);
    const [script, numKeys, key, ttl] = calls[0] as [string, number, string, string];
    expect(script).toMatch(/INCR/);
    expect(script).toMatch(/PTTL[^]*< 0[^]*PEXPIRE/);
    expect([numKeys, key, ttl]).toEqual([1, 'p:phone', '60000']);
  });
});

describe('session cut-off: exact instant against a millisecond issue claim', () => {
  const SECRET = 'x'.repeat(40);

  it('the cut-off is the exact instant, not the start of the second', () => {
    const now = new Date('2026-11-01T12:00:00.400Z');
    expect(sessionCutoffAt(now).toISOString()).toBe('2026-11-01T12:00:00.400Z');
  });

  it('a token issued earlier in the SAME second as a reset dies; one issued after it lives', async () => {
    vi.useFakeTimers();
    try {
      const signer = new Hs256TokenSigner(SECRET, '');
      vi.setSystemTime(new Date('2026-11-01T12:00:00.100Z'));
      const before = await signer.verify(await signer.sign({ subject: 'u', email: 'e@x', ttlSeconds: 900 }));
      const cutoff = sessionCutoffAt(new Date('2026-11-01T12:00:00.400Z'));
      vi.setSystemTime(new Date('2026-11-01T12:00:00.700Z'));
      const after = await signer.verify(await signer.sign({ subject: 'u', email: 'e@x', ttlSeconds: 900 }));
      expect(isInvalidatedByCutoff(before!.issuedAt!, cutoff)).toBe(true);
      expect(isInvalidatedByCutoff(after!.issuedAt!, cutoff)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a legacy token without iat_ms falls back to the start of its second (fails safe on a tie)', async () => {
    const { createHmac } = await import('node:crypto');
    const b64 = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const iat = Math.floor(Date.now() / 1000);
    const head = b64(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const body = b64(Buffer.from(JSON.stringify({ sub: 'u', email: 'e@x', iat, exp: iat + 900 })));
    const sig = b64(createHmac('sha256', SECRET).update(`${head}.${body}`).digest());
    const verified = await new Hs256TokenSigner(SECRET, '').verify(`${head}.${body}.${sig}`);
    expect(verified!.issuedAt!.getTime()).toBe(iat * 1000);
    expect(isInvalidatedByCutoff(verified!.issuedAt!, sessionCutoffAt(new Date(iat * 1000 + 500)))).toBe(true);
  });

  it('reset, SMS reset, change-password, social takeover and logout-all stamp the exact instant', () => {
    for (const f of [
      'apps/api/src/infrastructure/db/repositories/DrizzleAccountRecoveryRepository.ts',
      'apps/api/src/infrastructure/db/repositories/DrizzleUserRepository.ts',
      'apps/api/src/infrastructure/db/repositories/DrizzleSocialIdentityRepository.ts',
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(/date_trunc\('second', now\(\)\)/);
      expect(src, f).toMatch(/sessions_invalidated_after = clock_timestamp\(\)/);
    }
    expect(read('apps/api/src/infrastructure/security/SessionService.ts')).toMatch(/invalidateSessionsAfter\(userId, sessionCutoffAt\(now\)\)/);
  });
});

describe('password reset: a ceiling on length, checked before any hashing', () => {
  const huge = 'x'.repeat(201);

  it('link reset refuses a 201-character password without looking up the token or hashing', async () => {
    const hash = vi.fn(async (p: string) => p);
    const findByTokenHash = vi.fn(async () => null);
    const uc = new ResetPasswordUseCase({ findByTokenHash } as never, { hash } as never);
    const res = await uc.execute({ token: 'tok', newPassword: huge });
    expect(res).toMatchObject({ ok: false, code: 'WEAK_PASSWORD' });
    expect(findByTokenHash).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
  });

  it('200 characters is still allowed through to the token check', async () => {
    const findByTokenHash = vi.fn(async () => null);
    const uc = new ResetPasswordUseCase({ findByTokenHash } as never, { hash: async (p: string) => p } as never);
    expect(await uc.execute({ token: 'tok', newPassword: 'x'.repeat(200) })).toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('SMS reset refuses it too', async () => {
    const hash = vi.fn(async (p: string) => p);
    const uc = new ResetPasswordWithSmsCodeUseCase({} as never, {} as never, {} as never, { hash } as never, (v: string) => v);
    expect(await uc.execute({ phone: '0772000000', code: '123456', newPassword: huge })).toMatchObject({ ok: false, code: 'WEAK_PASSWORD' });
    expect(hash).not.toHaveBeenCalled();
  });
});

describe('in-memory login store: remembered pairs are bounded', () => {
  it('never holds more than MAX_REMEMBERED, dropping the oldest', async () => {
    const store = new InMemoryLoginAttemptStore();
    for (let i = 0; i < MAX_REMEMBERED + 5; i += 1) await store.remember(`k${i}`, 3600);
    expect((store as any).remembered.size).toBe(MAX_REMEMBERED);
    expect(await store.isRemembered('k0')).toBe(false);
    expect(await store.isRemembered(`k${MAX_REMEMBERED + 4}`)).toBe(true);
  });

  it('prune drops expired pairs', async () => {
    const store = new InMemoryLoginAttemptStore();
    await store.remember('gone', -1);
    await store.remember('kept', 3600);
    (store as any).prune();
    expect([...(store as any).remembered.keys()]).toEqual(['kept']);
  });
});
