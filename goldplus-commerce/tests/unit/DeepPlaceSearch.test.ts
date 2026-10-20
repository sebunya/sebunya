import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepPlaceSearchUseCase, PAUSE_REFUSED_MS, SESSION_SUGGEST_CAP } from '../../apps/api/src/application/use-cases/locations/DeepPlaceSearchUseCases';
import { GooglePlacesProvider } from '../../apps/api/src/infrastructure/places/GooglePlacesProvider';
import { dailyAllowance, PLACE_POINT_TTL_SECONDS } from '../../apps/api/src/infrastructure/places/RedisPlaceStores';
import { classifyPublicEndpoint, publicEndpointPolicy } from '../../apps/api/src/domain/security/PublicEndpointPolicy';
import { PlaceProviderError } from '../../apps/api/src/application/ports/IPlaceSearch';
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
  it('stays hidden without a key, credits Google Maps, keeps the place id', () => {
    expect(client).toMatch(/let deepEnabled = false;/);
    expect(client).toMatch(/\/locations\/deep-status/);
    expect(client).toMatch(/function withDeepOffer/);
    expect(client).toMatch(/Results from Google Maps/);
    expect(client).toMatch(/gpsSource: 'map_place', placeId: opt\.deepPlaceId/);
  });
});

describe('Maps Platform Terms §3.2.3(c)(iv): Places coordinates never feed area matching or pricing', () => {
  it('the building pick returns a point for the rider and no areas', () => {
    const routes = read('apps/api/src/interfaces/http/routes/locations.ts');
    const deepPlace = routes.slice(routes.indexOf("routes.post('/deep-place'"), routes.indexOf("routes.post('/search-events'"));
    expect(deepPlace).not.toMatch(/nearestAreas|areas/);
  });

  it('the picker never offers our areas from a Google point; the customer types the area', () => {
    const client = read('apps/web/src/lib/locationPickerClient.ts');
    const pick = client.slice(client.indexOf('async function pickDeep'), client.indexOf('function choose('));
    expect(pick).not.toMatch(/offerAreas|locations\/near/);
    expect(pick).toMatch(/Now type the area it is in/);
  });

  it('checkout never prices with a map_place point, on the server or in the live quote', async () => {
    const { pinOf } = await import('../../apps/api/src/application/use-cases/commerce/CheckoutUseCase');
    expect(pinOf({ gpsLat: 0.33, gpsLng: 32.59, gpsSource: 'map_place' })).toBeNull();
    expect(pinOf({ gpsLat: 0.33, gpsLng: 32.59, gpsSource: 'device' })).toEqual({ lat: 0.33, lng: 32.59 });
    expect(read('apps/web/src/pages/checkout.astro')).toMatch(/loc\.gpsSource !== 'map_place'\) gps = /);
  });
});

describe('"Use my location" puts the actual location (owner, 2026-10-19)', () => {
  it('a phone fix commits in one tap as the current location; a vague fix or a Google pick does not', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('apps/web/src/lib/locationPickerClient.ts', 'utf8');
    const after = src.slice(src.indexOf('async function afterPin'), src.indexOf('function commitCurrentLocation'));
    expect(after).toMatch(/if \(!roughKm && pin\.gpsSource === 'device'\) \{\s*commitCurrentLocation\(areas\[0\]\)/);
    const commit = src.slice(src.indexOf('function commitCurrentLocation'), src.indexOf('function offerAreas'));
    expect(commit).toContain("'Your current location'");
    expect(commit).toContain('` · within ${pin.gpsAccuracyM} m`');
    // The rider and the customer see the real point.
    expect(src).toContain('View on map');
  });
});

describe('a refused key is named and paused, not swallowed (2026-10-20 billing hold)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const billingBody = {
    error: {
      code: 403,
      message: 'This API method requires billing to be enabled. Please enable billing on project #560552606263.',
      status: 'PERMISSION_DENIED',
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'BILLING_DISABLED', domain: 'googleapis.com' }],
    },
  };

  it("reads Google's ErrorInfo reason and sentence from the error body", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(billingBody), { status: 403 })));
    const err = await new GooglePlacesProvider('test-key').suggest({ query: 'parliament of uganda', sessionToken: SESSION }).catch((e) => e);
    expect(err).toBeInstanceOf(PlaceProviderError);
    expect(err).toMatchObject({ httpStatus: 403, reason: 'BILLING_DISABLED' });
    expect(err.detail).toContain('requires billing');
    expect(err.detail).not.toContain('test-key');
  });

  it('falls back to the status, then the HTTP code, when Google gives no reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'x' } }), { status: 400 })));
    await expect(new GooglePlacesProvider('k').locate({ placeId: 'ChIJabc1234567', sessionToken: SESSION })).rejects.toMatchObject({ reason: 'INVALID_ARGUMENT' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })));
    await expect(new GooglePlacesProvider('k').locate({ placeId: 'ChIJabc1234567', sessionToken: SESSION })).rejects.toMatchObject({ reason: 'HTTP_502', httpStatus: 502 });
  });

  function refusing(err: PlaceProviderError) {
    const p = provider();
    p.suggest = async () => { p.suggestCalls++; throw err; };
    return p;
  }

  it('one refusal pauses every call, spends nothing more, and hides the option until the pause ends', async () => {
    let t = Date.parse('2026-10-20T10:00:00Z');
    const p = refusing(new PlaceProviderError(403, 'BILLING_DISABLED', 'billing'));
    const b = budget();
    const faults: string[] = [];
    const uc = new DeepPlaceSearchUseCase(p, b, cache(), () => t, undefined, (f) => faults.push(f.reason));
    expect(await uc.available()).toBe(true);
    expect((await uc.suggest({ query: 'parliament of uganda', sessionToken: SESSION })).status).toBe('unavailable');
    expect(faults).toEqual(['BILLING_DISABLED']);
    expect(await uc.available()).toBe(false);
    expect((await uc.suggest({ query: 'acacia mall', sessionToken: SESSION })).status).toBe('unavailable');
    expect(p.suggestCalls).toBe(1);
    expect(b.spent.suggest).toBe(1);
    const h = await uc.healthReport();
    expect(h?.lastFault).toMatchObject({ reason: 'BILLING_DISABLED', httpStatus: 403, kind: 'suggest' });
    expect(h?.pausedUntil).toBe(new Date(t + PAUSE_REFUSED_MS).toISOString());
    t += PAUSE_REFUSED_MS + 1;
    expect(await uc.available()).toBe(true);
  });

  it('a timeout is one request\'s bad luck: no pause', async () => {
    const p = refusing(new PlaceProviderError(null, 'TIMEOUT', 'slow'));
    const uc = new DeepPlaceSearchUseCase(p, budget(), cache());
    await uc.suggest({ query: 'acacia mall', sessionToken: SESSION });
    expect(await uc.available()).toBe(true);
    await uc.suggest({ query: 'acacia mall', sessionToken: SESSION });
    expect(p.suggestCalls).toBe(2);
  });

  it('a success is recorded, so the admin page can say when Google last answered', async () => {
    const t = Date.parse('2026-10-20T11:00:00Z');
    const uc = new DeepPlaceSearchUseCase(provider(), budget(), cache(), () => t);
    expect((await uc.suggest({ query: 'acacia mall', sessionToken: SESSION })).status).toBe('ok');
    expect((await uc.healthReport())?.lastOkAt).toBe(new Date(t).toISOString());
  });

  it('deep-status offers the layer only while it is available; the admin page shows the refusal and its fix', () => {
    const routes = read('apps/api/src/interfaces/http/routes/locations.ts');
    expect(routes).toMatch(/deep-status[\s\S]{0,200}deepPlaceSearchUseCase\.available\(\)/);
    const page = read('apps/web/src/pages/admin/locations.astro');
    expect(page).toContain('BILLING_DISABLED');
    expect(page).toContain('data-places-health');
    const client = read('apps/web/src/lib/locationPickerClient.ts');
    expect(client).toContain('Building search is not working right now');
  });
});
