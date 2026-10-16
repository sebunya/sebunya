import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepPlaceSearchUseCase, SESSION_SUGGEST_CAP } from '../../apps/api/src/application/use-cases/locations/DeepPlaceSearchUseCases';
import { GooglePlacesProvider } from '../../apps/api/src/infrastructure/places/GooglePlacesProvider';
import { stripMapPlaceCoordinates } from '../../apps/api/src/application/use-cases/commerce/CheckoutUseCase';
import type { IMonthlyRequestBudget, IPlaceSearchProvider } from '../../apps/api/src/application/ports/IPlaceSearch';

const SESSION = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';

function provider(configured = true) {
  const p: IPlaceSearchProvider & { suggestCalls: number; locateCalls: number } = {
    suggestCalls: 0,
    locateCalls: 0,
    configured: () => configured,
    suggest: async () => { p.suggestCalls++; return [{ placeId: 'ChIJ_acacia_mall_id', name: 'Acacia Mall', detail: 'Kisementi, Kampala' }]; },
    locate: async () => { p.locateCalls++; return { lat: 0.3378, lng: 32.5946, address: 'Acacia Ave, Kampala' }; },
  };
  return p;
}
function budget(left: number): IMonthlyRequestBudget & { spent: number } {
  const b = { spent: 0, tryConsume: async () => { if (b.spent >= left) return false; b.spent++; return true; }, used: async () => b.spent };
  return b;
}

describe('deep place search spends only where it must', () => {
  it('says Not configured without a key, and spends nothing', async () => {
    const b = budget(10);
    const r = await new DeepPlaceSearchUseCase(provider(false), b).suggest({ query: 'acacia mall', sessionToken: SESSION });
    expect(r.status).toBe('not_configured');
    expect(b.spent).toBe(0);
  });

  it('refuses queries under four characters', async () => {
    const p = provider();
    expect((await new DeepPlaceSearchUseCase(p, budget(10)).suggest({ query: 'aca', sessionToken: SESSION })).status).toBe('too_short');
    expect(p.suggestCalls).toBe(0);
  });

  it('stops at the monthly budget: no counter, no call', async () => {
    const p = provider();
    const uc = new DeepPlaceSearchUseCase(p, budget(0));
    expect((await uc.suggest({ query: 'acacia mall', sessionToken: SESSION })).status).toBe('budget_reached');
    expect(p.suggestCalls).toBe(0);
  });

  it('caps suggestion calls per customer session', async () => {
    const p = provider();
    const uc = new DeepPlaceSearchUseCase(p, budget(100));
    for (let i = 0; i < SESSION_SUGGEST_CAP; i++) expect((await uc.suggest({ query: `acacia mall ${i}`, sessionToken: SESSION })).status).toBe('ok');
    expect((await uc.suggest({ query: 'acacia mall again', sessionToken: SESSION })).status).toBe('session_limit');
    expect(p.suggestCalls).toBe(SESSION_SUGGEST_CAP);
  });

  it('locate draws on the budget, rejects junk ids and points outside Uganda', async () => {
    const b = budget(5);
    const uc = new DeepPlaceSearchUseCase(provider(), b);
    expect((await uc.locate({ placeId: 'x', sessionToken: SESSION })).status).toBe('unavailable');
    const ok = await uc.locate({ placeId: 'ChIJ_acacia_mall_id', sessionToken: SESSION });
    expect(ok.status).toBe('ok');
    expect(b.spent).toBe(1);
    const abroad = provider();
    abroad.locate = async () => ({ lat: 51.5, lng: -0.12, address: 'London' });
    expect((await new DeepPlaceSearchUseCase(abroad, budget(5)).locate({ placeId: 'ChIJ_london_place', sessionToken: SESSION })).status).toBe('unavailable');
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
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ input: 'acacia mall', sessionToken: SESSION, includedRegionCodes: ['ug'] });
    expect(body.locationBias.circle.radius).toBeLessThanOrEqual(50000);
    expect(out).toEqual([{ placeId: 'ChIJabc1234567', name: 'Acacia Mall', detail: 'Kisementi, Kampala' }]);
  });

  it('details: only Essentials fields (location, shortFormattedAddress), never displayName (Pro)', async () => {
    let headers: Record<string, string> = {};
    let url = '';
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit) => {
      url = u;
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ location: { latitude: 0.3378, longitude: 32.5946 }, shortFormattedAddress: 'Acacia Ave' }), { status: 200 });
    }));
    const p = await new GooglePlacesProvider('test-key').locate({ placeId: 'ChIJabc1234567', sessionToken: SESSION });
    expect(url).toContain(`sessionToken=${SESSION}`);
    expect(headers['X-Goog-FieldMask']).toBe('location,shortFormattedAddress');
    expect(p).toEqual({ lat: 0.3378, lng: 32.5946, address: 'Acacia Ave' });
  });
});

describe('Google-derived coordinates are never kept', () => {
  it('checkout drops a map_place pin after pricing; a device pin stays', () => {
    const place: Record<string, unknown> = { district: 'Kampala', gpsLat: 0.33, gpsLng: 32.59, gpsSource: 'map_place' };
    stripMapPlaceCoordinates(place);
    expect(place).toEqual({ district: 'Kampala', gpsSource: 'map_place' });
    const device: Record<string, unknown> = { district: 'Kampala', gpsLat: 0.33, gpsLng: 32.59, gpsSource: 'device' };
    stripMapPlaceCoordinates(device);
    expect(device.gpsLat).toBe(0.33);
  });

  it('the address book never receives them', () => {
    const page = readFileSync(new URL('../../apps/web/src/pages/account/addresses.astro', import.meta.url), 'utf8');
    expect(page).toMatch(/loc\.gpsSource !== 'map_place'/);
  });
});

describe('the picker offers Google only when ours cannot answer', () => {
  const client = readFileSync(new URL('../../apps/web/src/lib/locationPickerClient.ts', import.meta.url), 'utf8');
  it('offers it for buildings and zero results, credits Google Maps, and prices from our own areas', () => {
    expect(client).toMatch(/function withDeepOffer/);
    expect(client).toMatch(/Results from Google Maps/);
    expect(client).toMatch(/offerAreas\(data\.areas/);
    expect(client).toMatch(/gpsSource: 'map_place'/);
    expect(client).toMatch(/deepSession = newSessionToken\(\); \/\/ the pick ended/);
  });
});
