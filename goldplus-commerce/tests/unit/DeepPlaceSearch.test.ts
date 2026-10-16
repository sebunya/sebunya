import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepPlaceSearchUseCase, SESSION_SUGGEST_CAP } from '../../apps/api/src/application/use-cases/locations/DeepPlaceSearchUseCases';
import { GooglePlacesProvider } from '../../apps/api/src/infrastructure/places/GooglePlacesProvider';
import { dailyAllowance, PLACE_POINT_TTL_SECONDS } from '../../apps/api/src/infrastructure/places/RedisPlaceStores';
import { classifyPublicEndpoint, publicEndpointPolicy } from '../../apps/api/src/domain/security/PublicEndpointPolicy';
import type { IPlaceLocationCache, IPlaceRequestBudget, IPlaceSearchProvider, PlacePoint, PlaceRequestKind } from '../../apps/api/src/application/ports/IPlaceSearch';

const SESSION = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

function provider(configured = true) {
  const p: IPlaceSearchProvider & { suggestCalls: number; locateCalls: number } = {
    suggestCalls: 0,
    locateCalls: 0,
    configured: () => configured,
    suggest: async () => { p.suggestCalls++; return [{ placeId: 'ChIJ_acacia_mall_id', name: 'Acacia Mall', detail: 'Kisementi, Kampala' }]; },
    locate: async () => { p.locateCalls++; return { lat: 0.3378, lng: 32.5946 }; },
  };
  return p;
}
function budget(left: Partial<Record<PlaceRequestKind, number>> = {}) {
  const spent: Record<PlaceRequestKind, number> = { suggest: 0, details: 0 };
  const b: IPlaceRequestBudget & { spent: typeof spent } = {
    spent,
    tryConsume: async (k) => { if (spent[k] >= (left[k] ?? 100)) return false; spent[k]++; return true; },
    usage: async () => null,
  };
  return b;
}
function cache() {
  const m = new Map<string, PlacePoint>();
  const c: IPlaceLocationCache & { m: typeof m } = { m, get: async (id) => m.get(id) ?? null, put: async (id, p) => { m.set(id, p); } };
  return c;
}

describe('deep place search spends only where it must', () => {
  it('says Not configured without a key, and spends nothing', async () => {
    const b = budget();
    const r = await new DeepPlaceSearchUseCase(provider(false), b, cache()).suggest({ query: 'acacia mall', sessionToken: SESSION });
    expect(r.status).toBe('not_configured');
    expect(b.spent).toEqual({ suggest: 0, details: 0 });
  });

  it('refuses queries under four characters', async () => {
    const p = provider();
    expect((await new DeepPlaceSearchUseCase(p, budget(), cache()).suggest({ query: 'aca', sessionToken: SESSION })).status).toBe('too_short');
    expect(p.suggestCalls).toBe(0);
  });

  it('suggestions and lookups have separate budgets (Google bills them as separate SKUs)', async () => {
    const p = provider();
    const uc = new DeepPlaceSearchUseCase(p, budget({ suggest: 0, details: 5 }), cache());
    expect((await uc.suggest({ query: 'acacia mall', sessionToken: SESSION })).status).toBe('budget_reached');
    expect(p.suggestCalls).toBe(0);
    expect((await uc.locate({ placeId: 'ChIJ_acacia_mall_id', sessionToken: SESSION })).status).toBe('ok');
  });

  it('caps suggestion calls per customer session', async () => {
    const p = provider();
    const uc = new DeepPlaceSearchUseCase(p, budget(), cache());
    for (let i = 0; i < SESSION_SUGGEST_CAP; i++) expect((await uc.suggest({ query: `acacia mall ${i}`, sessionToken: SESSION })).status).toBe('ok');
    expect((await uc.suggest({ query: 'acacia mall again', sessionToken: SESSION })).status).toBe('session_limit');
    expect(p.suggestCalls).toBe(SESSION_SUGGEST_CAP);
  });

  it('a building looked up in the last 30 days costs nothing the second time', async () => {
    const p = provider();
    const b = budget();
    const c = cache();
    const uc = new DeepPlaceSearchUseCase(p, b, c);
    const first = await uc.locate({ placeId: 'ChIJ_acacia_mall_id', sessionToken: SESSION });
    const second = await uc.locate({ placeId: 'ChIJ_acacia_mall_id', sessionToken: 'another-session-token-1234' });
    expect(first).toMatchObject({ status: 'ok', fromCache: false });
    expect(second).toMatchObject({ status: 'ok', fromCache: true, point: { lat: 0.3378, lng: 32.5946 } });
    expect(p.locateCalls).toBe(1);
    expect(b.spent.details).toBe(1);
  });

  it('rejects junk place ids and points outside Uganda, and never caches them', async () => {
    const c = cache();
    const abroad = provider();
    abroad.locate = async () => ({ lat: 51.5, lng: -0.12 });
    const uc = new DeepPlaceSearchUseCase(abroad, budget(), c);
    expect((await uc.locate({ placeId: 'x', sessionToken: SESSION })).status).toBe('unavailable');
    expect((await uc.locate({ placeId: 'ChIJ_london_place', sessionToken: SESSION })).status).toBe('unavailable');
    expect(c.m.size).toBe(0);
  });
});

describe('pacing and retention', () => {
  it('spreads what is left of the month over the days left, doubled, so a burst spends a day not the month', () => {
    expect(dailyAllowance({ cap: 9500, usedBeforeToday: 0, daysLeftIncludingToday: 31 })).toBe(613);
    expect(dailyAllowance({ cap: 9500, usedBeforeToday: 9400, daysLeftIncludingToday: 10 })).toBe(50);
    expect(dailyAllowance({ cap: 9500, usedBeforeToday: 9480, daysLeftIncludingToday: 10 })).toBe(20);
    expect(dailyAllowance({ cap: 9500, usedBeforeToday: 9500, daysLeftIncludingToday: 10 })).toBe(0);
  });

  it('keeps a place point for exactly the 30 days the terms allow, set once (never extended on read)', () => {
    expect(PLACE_POINT_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(read('apps/api/src/infrastructure/places/RedisPlaceStores.ts')).toMatch(/'EX', PLACE_POINT_TTL_SECONDS, 'NX'/);
  });

  it('the nightly purge removes Google-derived coordinates from orders and addresses after 29 days, keeping the place id', () => {
    const purge = read('apps/api/src/scripts/geo-purge-pins.ts');
    expect(purge).toMatch(/MAP_PLACE_RETENTION_DAYS = 29/);
    expect(purge).toMatch(/delivery_location - 'gpsLat' - 'gpsLng' - 'gpsAccuracyM'/);
    expect(purge).toMatch(/update addresses set gps_lat = null, gps_lng = null/);
    expect(purge).not.toMatch(/- 'placeId'/);
  });

  it('the order keeps the place id, and the rider card links the exact building', () => {
    expect(read('apps/api/src/interfaces/http/routes/commerce.ts')).toMatch(/placeId: z\.string\(\)\.regex/);
    expect(read('apps/web/src/lib/checkout.ts')).toMatch(/\{ placeId: loc\.placeId \}/);
    expect(read('apps/web/src/pages/admin/orders/[id].astro')).toMatch(/query_place_id=/);
  });
});

describe('abuse control', () => {
  it('the paid endpoints have their own tight per-client limit; the free ones keep theirs', () => {
    expect(classifyPublicEndpoint('POST', '/locations/deep-search')).toBe('location-deep');
    expect(classifyPublicEndpoint('POST', '/locations/deep-place')).toBe('location-deep');
    expect(classifyPublicEndpoint('GET', '/locations/search')).toBe('location-search');
    expect(classifyPublicEndpoint('GET', '/locations/deep-status')).toBe('location-search');
    expect(publicEndpointPolicy('location-deep').limit).toBeLessThanOrEqual(20);
  });
});

describe('the Google requests are the cheapest that work', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('autocomplete: Uganda only, biased to Greater Kampala, session token, narrow field mask', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ suggestions: [{ placePrediction: { placeId: 'ChIJabc1234567', structuredFormat: { mainText: { text: 'Acacia Mall' }, secondaryText: { text: 'Kisementi, Kampala, Uganda' } } } }] }), { status: 200 });
    }));
    const out = await new GooglePlacesProvider('test-key').suggest({ query: 'acacia mall', sessionToken: SESSION });
    expect(calls[0].url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect((calls[0].init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe('suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ input: 'acacia mall', sessionToken: SESSION, includedRegionCodes: ['ug'] });
    expect(body.locationBias.circle.radius).toBeLessThanOrEqual(50000);
    expect(out).toEqual([{ placeId: 'ChIJabc1234567', name: 'Acacia Mall', detail: 'Kisementi, Kampala' }]);
  });

  it('details: location only (Essentials), never displayName (Pro), with the session token', async () => {
    let headers: Record<string, string> = {};
    let url = '';
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit) => {
      url = u;
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ location: { latitude: 0.3378, longitude: 32.5946 } }), { status: 200 });
    }));
    const p = await new GooglePlacesProvider('test-key').locate({ placeId: 'ChIJabc1234567', sessionToken: SESSION });
    expect(url).toContain(`sessionToken=${SESSION}`);
    expect(headers['X-Goog-FieldMask']).toBe('location');
    expect(p).toEqual({ lat: 0.3378, lng: 32.5946 });
  });
});

describe('the picker offers Google only when ours cannot answer', () => {
  const client = read('apps/web/src/lib/locationPickerClient.ts');
  it('stays hidden without a key, credits Google Maps, prices from our own areas, keeps the place id', () => {
    expect(client).toMatch(/let deepEnabled = false;/);
    expect(client).toMatch(/\/locations\/deep-status/);
    expect(client).toMatch(/function withDeepOffer/);
    expect(client).toMatch(/Results from Google Maps/);
    expect(client).toMatch(/offerAreas\(data\.areas/);
    expect(client).toMatch(/gpsSource: 'map_place', placeId: opt\.deepPlaceId/);
  });
});
