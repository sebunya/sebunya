import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { RedisAbuseControlStore } from '../../apps/api/src/infrastructure/security/RedisAbuseControlStore';
import {
  classifyPublicEndpoint,
  publicEndpointPolicy,
} from '../../apps/api/src/domain/security/PublicEndpointPolicy';

/**
 * Slice 3A end-to-end proof, on a REAL Redis, that the public abuse-control
 * layer keys on the route FAMILY and not the path. The unit suite proves the
 * classifier collapses paths; this proves the collapse survives all the way into
 * the distributed counter across two replicas — which is the property that
 * actually protects the platform.
 *
 * Set REDIS_TEST_URL to run; otherwise it reports skipped rather than passing
 * silently.
 */
const URL = process.env.REDIS_TEST_URL;
const suite = URL ? describe : describe.skip;
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Mirror what the middleware sends to the store for a given request.
const consumeAs = (
  store: RedisAbuseControlStore,
  method: string,
  path: string,
  identity: string,
) => {
  const family = classifyPublicEndpoint(method, path);
  const policy = publicEndpointPolicy(family);
  return store.consume({
    control: 'http',
    endpoint: family,
    identity,
    limit: { limit: policy.limit, windowMs: policy.windowMs },
    outagePolicy: policy.outage,
  });
};

suite('public abuse control keys on family, not path (real Redis)', () => {
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

  it('path variation within a family shares ONE budget, so it cannot be walked for free', async () => {
    // dealer-application allows 5/min. If each distinct path had its own counter
    // (the defect), 12 differently-shaped requests would all be allowed. Keyed on
    // family, the 6th is rejected regardless of path shape.
    const id = `t:203.0.113.9-${stamp()}`;
    const paths = [
      '/governance/dealers/apply',
      '/governance/dealers/apply?ref=1',
      '/governance/dealers/apply/',
      '/GOVERNANCE/dealers/apply',
      '/governance//dealers//apply',
      '/governance/dealers/apply?ref=2',
      '/governance/dealers/apply#x',
    ];
    const results = [];
    for (const p of paths) results.push(await consumeAs(replicaA, 'POST', p, id));
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(publicEndpointPolicy('dealer-application').limit); // exactly 5
    expect(results.some((r) => !r.allowed)).toBe(true);
    expect(results.every((r) => !r.degraded)).toBe(true);
  });

  it('two replicas share one family budget rather than one each', async () => {
    // quote-request: 10/min. Five on each replica must total ten, then reject.
    const id = `t:198.51.100.4-${stamp()}`;
    const limit = publicEndpointPolicy('quote-request').limit;
    const results = [];
    for (let i = 0; i < limit / 2; i++)
      results.push(await consumeAs(replicaA, 'POST', '/governance/quotes/request', id));
    for (let i = 0; i < limit / 2; i++)
      results.push(await consumeAs(replicaB, 'POST', '/governance/quotes/request', id));
    // One more, on either replica, is over the shared budget.
    const over = await consumeAs(replicaB, 'POST', '/governance/quotes/request', id);
    expect(results.filter((r) => r.allowed)).toHaveLength(limit);
    expect(over.allowed).toBe(false);
  });

  it('different families do not share a budget with each other', async () => {
    const id = `t:203.0.113.20-${stamp()}`;
    // Exhaust dealer-application (5/min)...
    for (let i = 0; i < 6; i++) await consumeAs(replicaA, 'POST', '/governance/dealers/apply', id);
    // ...a quote request from the same client is a different family and still allowed.
    expect((await consumeAs(replicaA, 'POST', '/governance/quotes/request', id)).allowed).toBe(true);
  });

  it('a rejected decision carries a future reset the middleware turns into Retry-After', async () => {
    const id = `t:203.0.113.21-${stamp()}`;
    for (let i = 0; i < 6; i++) await consumeAs(replicaA, 'POST', '/governance/dealers/apply', id);
    const denied = await consumeAs(replicaA, 'POST', '/governance/dealers/apply', id);
    expect(denied.allowed).toBe(false);
    expect(denied.resetAtMs).toBeGreaterThan(Date.now());
  });

  it('stores no raw path or identity in any key', async () => {
    await consumeAs(replicaA, 'POST', '/governance/dealers/apply', 't:203.0.113.9-keyprobe');
    const keys = await raw.keys('abuse:*');
    expect(keys.length).toBeGreaterThan(0);
    // The family name is readable; the path and the address are not.
    expect(keys.some((k) => k.includes('dealer-application') || k.includes('http'))).toBe(true);
    expect(keys.filter((k) => k.includes('203.0.113.9') || k.includes('/governance'))).toEqual([]);
  });
});
