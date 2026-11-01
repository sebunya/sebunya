import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeploymentService,
  FLAG_CACHE_MS,
  isAllowedShadowHost,
  isShadowablePath,
  shadowSafeHeaders,
  type DeploymentFlagStore,
} from '../../apps/api/src/infrastructure/deployment/DeploymentService';

/**
 * The freeze and the shadow settings were fields on one process while two API
 * replicas serve traffic; and shadow mirroring replayed writes, with credentials,
 * to any URL an admin typed.
 */
function memoryStore(): DeploymentFlagStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    read: async () => ({ maintenance: data.maintenance ?? null, shadow: data.shadow ?? null }),
    write: async (key, value) => { data[key] = value; },
  };
}
function replica(store: DeploymentFlagStore | null): DeploymentService {
  const svc = Object.create(DeploymentService.prototype) as DeploymentService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    isFreeze: false, healthScore: 100, shadowRatio: 0, shadowUrl: '', flagsReadAt: 0, flagsShared: false,
  });
  svc.useFlagStore(store);
  return svc;
}

afterEach(() => vi.restoreAllMocks());

describe('the maintenance freeze reaches every replica', () => {
  it('a freeze set through replica A is enforced by replica B', async () => {
    const store = memoryStore();
    const a = replica(store);
    const b = replica(store);
    expect(await a.setMaintenanceMode(true)).toBe(true);
    expect(await b.refreshFlags({ now: Date.now() + FLAG_CACHE_MS + 1 })).toBe(true);
  });

  it('says so when it could only apply to this replica', async () => {
    const broken: DeploymentFlagStore = {
      read: async () => { throw new Error('ECONNREFUSED'); },
      write: async () => { throw new Error('ECONNREFUSED'); },
    };
    const a = replica(broken);
    expect(await a.setMaintenanceMode(true)).toBe(false);
    expect(a.getMaintenanceMode()).toBe(true);
    // An unreadable store keeps what the replica last knew.
    expect(await a.refreshFlags({ force: true })).toBe(true);
    expect(a.flagsAreShared()).toBe(false);
  });
});

describe('shadow traffic mirrors reads only, without credentials, to internal hosts', () => {
  it('accepts only internal targets', () => {
    expect(isAllowedShadowHost('shadow-api', {})).toBe(true);
    expect(isAllowedShadowHost('127.0.0.1', {})).toBe(true);
    expect(isAllowedShadowHost('evil.example.com', {})).toBe(false);
    expect(isAllowedShadowHost('canary.internal.lan', { SHADOW_TRAFFIC_ALLOWED_HOSTS: 'canary.internal.lan' })).toBe(true);
    const svc = replica(null);
    expect(svc.setShadowUrl('https://evil.example.com')).toBe(false);
    expect(svc.setShadowUrl('http://shadow-api:3000')).toBe(true);
  });

  it('never mirrors money, callbacks, sign-in or admin paths', () => {
    for (const p of ['/webhooks/mtn', '/commerce/payments/pesapal/ipn', '/auth/login', '/admin/orders', '/health/ready']) {
      expect(isShadowablePath(p), p).toBe(false);
    }
    expect(isShadowablePath('/products/power-bank')).toBe(true);
  });

  it('drops every credential header', () => {
    const safe = shadowSafeHeaders({
      Authorization: 'Bearer s', cookie: 'c', 'x-goldplus-cart': 't', 'x-gp-visit': 'v',
      'x-lighthouse-watch-token': 'w', 'x-goldplus-signature': 'g', 'x-api-key': 'k', accept: 'application/json',
    });
    expect(safe).toEqual({ accept: 'application/json' });
  });

  it('does not mirror a write, and bounds the mirror it sends', async () => {
    const svc = replica(null);
    svc.setShadowUrl('http://shadow-api:3000');
    await svc.setShadowTrafficRatio(1);
    const fetchImpl = vi.fn(async () => new Response(''));
    await svc.mirrorTrafficIfSelected('https://api.shopgoldplus.com/commerce/orders/create', 'POST', {}, '{}', fetchImpl as never, () => 0);
    expect(fetchImpl).not.toHaveBeenCalled();
    await svc.mirrorTrafficIfSelected('https://api.shopgoldplus.com/products?q=x', 'GET', { authorization: 'Bearer s' }, null, fetchImpl as never, () => 0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://shadow-api:3000/products?q=x');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ 'X-Shadow-Request': 'true' });
    expect(init.body).toBeUndefined();
  });
});
