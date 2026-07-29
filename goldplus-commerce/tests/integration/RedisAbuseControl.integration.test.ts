import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { RedisAbuseControlStore } from '../../apps/api/src/infrastructure/security/RedisAbuseControlStore';
import { RedisLoginAttemptStore } from '../../apps/api/src/infrastructure/security/RedisLoginAttemptStore';
import { evaluateLoginLock } from '../../apps/api/src/domain/identity/LoginThrottle';

/**
 * These run against a REAL redis-server, because the whole claim being made is
 * that the controls hold across processes. An in-process double cannot show
 * that: it would pass just as happily against the per-replica Map these controls
 * replaced, which is exactly the defect.
 *
 * Set REDIS_TEST_URL to run. Without it the suite reports as skipped rather than
 * silently passing — a control proof that quietly does nothing is worse than no
 * proof, because it reads like evidence.
 */
const URL = process.env.REDIS_TEST_URL;
const suite = URL ? describe : describe.skip;

const base = { limit: 5, windowMs: 60_000 };
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

suite('distributed abuse control (real Redis)', () => {
  let replicaA: RedisAbuseControlStore;
  let replicaB: RedisAbuseControlStore;
  let raw: Redis;

  beforeAll(() => {
    replicaA = new RedisAbuseControlStore(URL);
    replicaB = new RedisAbuseControlStore(URL);
    raw = new Redis(URL!);
  });

  afterAll(async () => {
    await replicaA.close();
    await replicaB.close();
    await raw.quit();
  });

  const consume = (store: RedisAbuseControlStore, identity: string, limit = base) =>
    store.consume({ control: 'proof', endpoint: '/login', identity, limit });

  it('two API replicas share one limit instead of one each', async () => {
    // The defect: N replicas each enforcing the limit meant the effective limit
    // was limit × N, and nothing in the configuration said so.
    const id = stamp();
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await consume(replicaA, id));
    for (let i = 0; i < 3; i++) results.push(await consume(replicaB, id));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.every((r) => !r.degraded)).toBe(true);
  });

  it('a restarted process still sees the exhausted limit', async () => {
    const id = stamp();
    for (let i = 0; i < 5; i++) await consume(replicaA, id);
    const restarted = new RedisAbuseControlStore(URL);
    try {
      expect((await consume(restarted, id)).allowed).toBe(false);
    } finally {
      await restarted.close();
    }
  });

  it('counts every one of 200 concurrent increments', async () => {
    // INCR is atomic; a read-modify-write would lose most of these.
    const id = stamp();
    const wide = { limit: 1000, windowMs: 60_000 };
    await Promise.all(Array.from({ length: 200 }, () => consume(replicaA, id, wide)));
    expect((await consume(replicaA, id, wide)).count).toBe(201);
  });

  it('expires the window so a limited client recovers', async () => {
    const id = stamp();
    const short = { limit: 2, windowMs: 1000 };
    await consume(replicaA, id, short);
    await consume(replicaA, id, short);
    expect((await consume(replicaA, id, short)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 2100));
    expect((await consume(replicaA, id, short)).allowed).toBe(true);
  }, 10_000);

  it('a flooded unattributed bucket cannot block an identified client', async () => {
    // A single shared `ip-unknown` identity would make this the opposite: one
    // caller suppressing its own identity would lock out everyone unresolvable.
    const s = stamp();
    for (let i = 0; i < 60; i++) await consume(replicaA, `x:unattributed-${s}`);
    expect((await consume(replicaA, `t:203.0.113.7-${s}`)).allowed).toBe(true);
  }, 15_000);

  it('keeps no raw address or email in any key, and every key expires', async () => {
    await consume(replicaA, 't:203.0.113.7-leak-probe');
    const keys = await raw.keys('abuse:*');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => k.includes('203.0.113.7') || k.includes('@'))).toEqual([]);
    expect(Math.max(...keys.map((k) => k.length))).toBeLessThan(160);
    const ttls = await Promise.all(keys.slice(0, 10).map((k) => raw.ttl(k)));
    // -1 means "no expiry": a counter that never resets locks a client out forever.
    expect(ttls.every((t) => t > 0)).toBe(true);
  });
});

suite('degraded policy when Redis is unreachable', () => {
  const dead = 'redis://127.0.0.1:6555';

  it('engages the documented degraded policy rather than failing open or closed', async () => {
    const store = new RedisAbuseControlStore(dead);
    try {
      const id = stamp();
      const first = await store.consume({
        control: 'proof',
        endpoint: '/login',
        identity: id,
        limit: base,
      });
      expect(first.degraded).toBe(true);
      // Stricter, because the fallback is per-replica and therefore multiplies.
      expect(first.limit).toBeLessThan(base.limit);

      let blocked = false;
      for (let i = 0; i < 10; i++) {
        const d = await store.consume({
          control: 'proof',
          endpoint: '/login',
          identity: id,
          limit: base,
        });
        if (!d.allowed) {
          blocked = true;
          break;
        }
      }
      // It still limits — a control that fails open removes protection exactly
      // when the platform is least healthy.
      expect(blocked).toBe(true);
    } finally {
      await store.close();
    }
  }, 20_000);
});

suite('login lockout across replicas (real Redis)', () => {
  it('locks after five failures counted across two replicas, not five each', async () => {
    const key = `lockout|${stamp()}`;
    const a = new RedisLoginAttemptStore(URL);
    const b = new RedisLoginAttemptStore(URL);
    try {
      for (let i = 0; i < 3; i++) await a.addFailure(key, new Date());
      for (let i = 0; i < 2; i++) await b.addFailure(key, new Date());

      const seenByA = evaluateLoginLock(await a.getFailures(key), new Date());
      const seenByB = evaluateLoginLock(await b.getFailures(key), new Date());
      expect(seenByA.failuresInWindow).toBe(5);
      expect(seenByA.locked).toBe(true);
      // Both replicas must agree; a lockout one instance disagrees with is not one.
      expect(seenByB.locked).toBe(true);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('records simultaneous failures separately rather than deduplicating them', async () => {
    const key = `simultaneous|${stamp()}`;
    const store = new RedisLoginAttemptStore(URL);
    try {
      const at = new Date();
      await Promise.all(Array.from({ length: 5 }, () => store.addFailure(key, at)));
      expect((await store.getFailures(key)).length).toBe(5);
    } finally {
      await store.close();
    }
  });

  it('clears on success and does not resurrect from the local fallback', async () => {
    const key = `clear|${stamp()}`;
    const store = new RedisLoginAttemptStore(URL);
    try {
      for (let i = 0; i < 5; i++) await store.addFailure(key, new Date());
      await store.clear(key);
      expect(await store.getFailures(key)).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it('stores no plaintext email in any login key', async () => {
    const store = new RedisLoginAttemptStore(URL);
    const probe = new Redis(URL!);
    try {
      await store.addFailure(`victim@example.com|203.0.113.7`, new Date());
      const keys = await probe.keys('login:fail:*');
      expect(keys.filter((k) => k.includes('victim@example.com'))).toEqual([]);
      expect(keys.length).toBeGreaterThan(0);
    } finally {
      await store.close();
      await probe.quit();
    }
  });
});
