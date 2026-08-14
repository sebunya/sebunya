import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Recommendation identity and placement, at the producer.
 *
 * The analytics module reported a high volume of events missing anonymousId
 * and some missing placement. The cause was not the analytics layer: the
 * browser helpers read localStorage and sessionStorage and returned null on
 * any failure, while the event tracker deliberately still sent the event. Every
 * visitor in private browsing, an embedded webview, or with storage disabled
 * therefore produced a stream of events nothing could be joined to.
 *
 * These tests pin the degrade-don't-fail behaviour that replaced it.
 */

/** A storage that refuses everything, as private browsing does. */
function blockedStorage(): Storage {
  const refuse = () => { throw new DOMException('blocked', 'SecurityError'); };
  return { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, key: refuse, length: 0 } as unknown as Storage;
}

/** A storage that accepts writes and silently discards them, as quota-full does. */
function amnesiacStorage(): Storage {
  return {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

function workingStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as unknown as Storage;
}

function installWindow(local: Storage, session: Storage) {
  vi.stubGlobal('window', { localStorage: local, sessionStorage: session });
  vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => { a.fill(7); return a; } });
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function loadIdentity() {
  const mod = await import('../../apps/web/src/lib/anonymous-id');
  mod.__resetEphemeralAnonymousId();
  return mod;
}

describe('a visitor always gets an identifier, at the best durability available', () => {
  it('uses localStorage when it works, and reports PERSISTENT', async () => {
    installWindow(workingStorage(), workingStorage());
    const { resolveAnonymousIdentity } = await loadIdentity();
    const r = resolveAnonymousIdentity();
    expect(r.id).toMatch(/^anon_[a-zA-Z0-9_-]{12,}$/);
    expect(r.durability).toBe('PERSISTENT');
  });

  it('returns the SAME id on repeated calls', async () => {
    installWindow(workingStorage(), workingStorage());
    const { resolveAnonymousIdentity } = await loadIdentity();
    expect(resolveAnonymousIdentity().id).toBe(resolveAnonymousIdentity().id);
  });

  it('falls back to sessionStorage when localStorage is blocked', async () => {
    installWindow(blockedStorage(), workingStorage());
    const { resolveAnonymousIdentity } = await loadIdentity();
    const r = resolveAnonymousIdentity();
    expect(r.id).not.toBeNull();
    expect(r.durability).toBe('SESSION');
  });

  it('falls back to memory when BOTH storages are blocked', async () => {
    // The case that produced the missing-anonymousId volume: previously null.
    installWindow(blockedStorage(), blockedStorage());
    const { resolveAnonymousIdentity } = await loadIdentity();
    const r = resolveAnonymousIdentity();
    expect(r.id).toMatch(/^anon_/);
    expect(r.durability).toBe('EPHEMERAL');
  });

  it('keeps the ephemeral id stable within the page view', async () => {
    installWindow(blockedStorage(), blockedStorage());
    const { resolveAnonymousIdentity } = await loadIdentity();
    // Without stability the impression and its click look like two visitors.
    expect(resolveAnonymousIdentity().id).toBe(resolveAnonymousIdentity().id);
  });

  it('detects storage that accepts a write and discards it', async () => {
    // Trusting setItem here would mint a fresh id on every call, making every
    // event look like a different visitor — worse than having no id at all.
    installWindow(amnesiacStorage(), amnesiacStorage());
    const { resolveAnonymousIdentity } = await loadIdentity();
    const r = resolveAnonymousIdentity();
    expect(r.durability).toBe('EPHEMERAL');
    expect(resolveAnonymousIdentity().id).toBe(r.id);
  });

  it('reports UNAVAILABLE server-side rather than inventing an identity', async () => {
    vi.stubGlobal('window', undefined);
    const { resolveAnonymousIdentity } = await loadIdentity();
    const r = resolveAnonymousIdentity();
    expect(r.id).toBeNull();
    expect(r.durability).toBe('UNAVAILABLE');
  });

  it('rejects a malformed stored value and reissues', async () => {
    const local = workingStorage();
    local.setItem('goldplus_anonymous_id', 'not-a-valid-id');
    installWindow(local, workingStorage());
    const { resolveAnonymousIdentity } = await loadIdentity();
    expect(resolveAnonymousIdentity().id).toMatch(/^anon_/);
  });

  it('carries no personal data — it is random and opaque', async () => {
    installWindow(workingStorage(), workingStorage());
    const { resolveAnonymousIdentity } = await loadIdentity();
    const id = resolveAnonymousIdentity().id!;
    expect(id).toMatch(/^anon_[0-9a-f]+$/);
    expect(id).not.toMatch(/@|\+256|goldplus\.com/);
  });
});

describe('click attribution survives blocked storage', () => {
  async function loadRecs() {
    vi.resetModules();
    return import('../../apps/web/src/lib/recommendations');
  }

  const attribution = {
    attributionId: 'attr-1',
    placement: 'product_related',
    productId: 'prod-1',
    ruleId: 'rule-1',
    railRenderId: 'rail-1',
  };

  it('round-trips through working sessionStorage', async () => {
    installWindow(workingStorage(), workingStorage());
    const { persistClickAttribution, getAndClearClickAttribution } = await loadRecs();
    persistClickAttribution(attribution);
    const got = getAndClearClickAttribution();
    expect(got?.placement).toBe('product_related');
    expect(got?.attributionId).toBe('attr-1');
  });

  it('PRESERVES placement when sessionStorage is blocked', async () => {
    // Previously this returned null, so the add-to-cart that followed a
    // recommendation click had no placement and no recommendation to credit.
    installWindow(blockedStorage(), blockedStorage());
    const { persistClickAttribution, getAndClearClickAttribution } = await loadRecs();
    persistClickAttribution(attribution);
    const got = getAndClearClickAttribution();
    expect(got).not.toBeNull();
    expect(got?.placement).toBe('product_related');
  });

  it('is consumed exactly once', async () => {
    installWindow(blockedStorage(), blockedStorage());
    const { persistClickAttribution, getAndClearClickAttribution } = await loadRecs();
    persistClickAttribution(attribution);
    expect(getAndClearClickAttribution()).not.toBeNull();
    // A second read must not re-credit the same click.
    expect(getAndClearClickAttribution()).toBeNull();
  });

  it('returns null when nothing was ever persisted', async () => {
    installWindow(workingStorage(), workingStorage());
    const { getAndClearClickAttribution } = await loadRecs();
    expect(getAndClearClickAttribution()).toBeNull();
  });

  it('rejects an attribution older than its 30 minute window', async () => {
    installWindow(workingStorage(), workingStorage());
    const { persistClickAttribution, getAndClearClickAttribution } = await loadRecs();
    persistClickAttribution(attribution);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60 * 1000);
    expect(getAndClearClickAttribution()).toBeNull();
    vi.restoreAllMocks();
  });

  it('does not credit a click to a different product', async () => {
    installWindow(blockedStorage(), blockedStorage());
    const { persistClickAttribution, getAndClearClickAttribution } = await loadRecs();
    persistClickAttribution(attribution);
    expect(getAndClearClickAttribution('a-different-product')).toBeNull();
  });
});

describe('the placement taxonomy is single and canonical', () => {
  it('accepts every declared placement and nothing else', async () => {
    const { RECOMMENDATION_PLACEMENTS, isRecommendationPlacement } = await import('@goldplus/shared');
    for (const p of RECOMMENDATION_PLACEMENTS) expect(isRecommendationPlacement(p)).toBe(true);
    // A second vocabulary would silently split placement reporting in two.
    expect(isRecommendationPlacement('home_hero_banner')).toBe(false);
    expect(isRecommendationPlacement('')).toBe(false);
    expect(isRecommendationPlacement(undefined)).toBe(false);
  });
});
