import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { areaPointFlags, feeShockAreas, parseLocationSignal, LOCATION_SIGNAL_RETENTION_DAYS, type AreaDemandRow } from '../../apps/api/src/domain/locations/LocationSignals';
import { GetDeliverToUseCase, RecordLocationSignalUseCase } from '../../apps/api/src/application/use-cases/locations/LocationSignalUseCases';
import type { ILocationSignalStore } from '../../apps/api/src/application/ports/ILocationSignalStore';
import { selectHeroSlides, HERO_SLIDE_LIBRARY, type HeroSelectionContext } from '../../packages/shared/src/hero';
import { isSameDayDispatchDistrict } from '../../apps/api/src/domain/locations/GreaterKampala';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

function fakeStore(personalisation: boolean) {
  const inserted: Array<Parameters<ILocationSignalStore['insert']>[0]> = [];
  const deliverTo: Record<string, { areaSlug: string | null; district: string; label: string }> = {};
  const kmCalls: Array<{ lat: number; lng: number }> = [];
  const store: ILocationSignalStore = {
    deliverToForProfile: async (id) => (deliverTo[id] ? { ...deliverTo[id], setAt: new Date() } : null),
    deliverToForCustomer: async (id) => (id === 'cust-1' ? { areaSlug: 'wakiso-kira-31340', district: 'Wakiso', label: 'Kira, Wakiso', setAt: new Date() } : null),
    setDeliverTo: async (id, p) => { deliverTo[id] = p; },
    consentFor: async () => ({ customerId: 'cust-1', personalisation }),
    kmToAreaPoint: async (_slug, p) => { kmCalls.push(p); return 1.4; },
    insert: async (row) => { inserted.push(row); },
    demandByArea: async () => [],
    areasConsidered: async () => [],
    purgeOlderThan: async () => 0,
  };
  return { store, inserted, deliverTo, kmCalls };
}

describe('a location signal is an area, a fee, a rank or a distance: never coordinates', () => {
  it('parses only known kinds and surfaces, and needs an area or a district', () => {
    expect(parseLocationSignal({ kind: 'teleport', surface: 'pdp', district: 'Kampala' })).toBeNull();
    expect(parseLocationSignal({ kind: 'quote_shown', surface: 'moon', district: 'Kampala' })).toBeNull();
    expect(parseLocationSignal({ kind: 'quote_shown', surface: 'pdp' })).toBeNull();
    expect(parseLocationSignal({ kind: 'quote_shown', surface: 'pdp', areaSlug: 'DROP TABLE', district: 'Kampala' })?.areaSlug).toBeNull();
  });

  it('a pin is accepted only for Locate me outcomes, and a rank only when an offer was chosen', () => {
    const q = parseLocationSignal({ kind: 'quote_shown', surface: 'pdp', district: 'Kampala', pin: { lat: 0.3, lng: 32.5 }, offerRank: 2 });
    expect(q?.pin).toBeNull();
    expect(q?.offerRank).toBeNull();
    const c = parseLocationSignal({ kind: 'locate_offer_chosen', surface: 'checkout', areaSlug: 'wakiso-kira-31340', district: 'Wakiso', pin: { lat: 0.39, lng: 32.6 }, offerRank: 2 });
    expect(c?.pin).toEqual({ lat: 0.39, lng: 32.6 });
    expect(c?.offerRank).toBe(2);
  });

  it('keeps 13 months, and the table cannot link a row to anyone without consent (migration CHECK)', () => {
    expect(LOCATION_SIGNAL_RETENTION_DAYS).toBe(395);
    const sql = read('apps/api/src/infrastructure/db/migrations/0193_location_signals.sql');
    expect(sql).toMatch(/CHECK \(personalisation or \(profile_id is null and customer_id is null\)\)/);
    const table = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS location_signals'), sql.indexOf(');', sql.indexOf('CREATE TABLE IF NOT EXISTS location_signals')));
    expect(table).not.toMatch(/\blat\b|\blng\b|latitude|longitude|\bip\b|user_agent/i);
    expect(read('apps/api/src/scripts/geo-purge-pins.ts')).toMatch(/delete from location_signals where occurred_at < \$\{signalCutoff\}/);
  });
});

describe('consent decides the link', () => {
  it('without personalisation the row is anonymous; "Deliver to" is still kept as their own preference', async () => {
    const f = fakeStore(false);
    const r = await new RecordLocationSignalUseCase(f.store).execute({
      raw: { kind: 'deliver_to_set', surface: 'pdp', areaSlug: 'wakiso-kira-31340', district: 'Wakiso', label: 'Kira, Wakiso' },
      profileId: 'prof-1',
      customerId: null,
    });
    expect(r).toBe('recorded');
    expect(f.deliverTo['prof-1']).toEqual({ areaSlug: 'wakiso-kira-31340', district: 'Wakiso', label: 'Kira, Wakiso' });
    expect(f.inserted[0]).toMatchObject({ profileId: null, customerId: null, personalisation: false });
  });

  it('with personalisation the row is linked; a Locate me pin becomes a distance and is not stored', async () => {
    const f = fakeStore(true);
    await new RecordLocationSignalUseCase(f.store).execute({
      raw: { kind: 'locate_offer_missed', surface: 'checkout', areaSlug: 'wakiso-kira-31340', district: 'Wakiso', pin: { lat: 0.39, lng: 32.6 } },
      profileId: 'prof-1',
      customerId: null,
    });
    expect(f.kmCalls).toEqual([{ lat: 0.39, lng: 32.6 }]);
    expect(f.inserted[0]).toMatchObject({ profileId: 'prof-1', customerId: 'cust-1', personalisation: true, offerKm: 1.4 });
    expect(JSON.stringify(f.inserted[0])).not.toMatch(/0\.39|32\.6\b/);
  });

  it('"Deliver to" follows a signed-in customer to another device', async () => {
    const f = fakeStore(true);
    expect((await new GetDeliverToUseCase(f.store).execute({ profileId: 'new-phone', customerId: 'cust-1' }))?.label).toBe('Kira, Wakiso');
    expect(await new GetDeliverToUseCase(f.store).execute({ profileId: 'new-phone', customerId: null })).toBeNull();
  });
});

describe('what the signals teach us', () => {
  const row = (p: Partial<AreaDemandRow>): AreaDemandRow => ({ areaSlug: 'x', label: 'X', district: 'Wakiso', deliverToSets: 0, feeViews: 0, orders: 0, medianFeeShownUgx: null, locateChosen: 0, locateMissed: 0, medianOfferKm: null, ...p });

  it('flags an area point when Locate me customers had to type the area, or chose it from far away', () => {
    const flags = areaPointFlags([
      row({ label: 'Typed', locateChosen: 1, locateMissed: 3 }),
      row({ label: 'Far', locateChosen: 5, locateMissed: 0, medianOfferKm: 4.2 }),
      row({ label: 'Fine', locateChosen: 6, locateMissed: 1, medianOfferKm: 0.8 }),
      row({ label: 'Too few', locateMissed: 2 }),
    ]);
    expect(flags.map((f) => f.label)).toEqual(['Typed', 'Far']);
  });

  it('ranks fee shock: many fee views, few orders, worst first', () => {
    const shock = feeShockAreas([row({ label: 'A', feeViews: 40, orders: 1 }), row({ label: 'B', feeViews: 20, orders: 8 }), row({ label: 'C', feeViews: 5, orders: 0 })]);
    expect(shock.map((s) => s.label)).toEqual(['A', 'B']);
  });
});

describe('the homepage uses the area the visitor told us, and never promises same-day outside it', () => {
  const ctx: HeroSelectionContext = { isNew: false, isReturning: true, isRegular: false, hasOrdered: false, saleLive: false, beforeCutoff: true, cartItems: 0, scratched: false, referred: false, serverCats: [] };
  it('the same-day slide sinks for a visitor outside Kampala & Wakiso', () => {
    const inside = selectHeroSlides(HERO_SLIDE_LIBRARY, ctx).map((s) => s.slideKey);
    const outside = selectHeroSlides(HERO_SLIDE_LIBRARY, { ...ctx, outsideSameDayArea: true }).map((s) => s.slideKey);
    expect(inside.indexOf('sameday')).toBeGreaterThanOrEqual(0);
    const o = outside.indexOf('sameday');
    expect(o === -1 || o > inside.indexOf('sameday')).toBe(true);
    expect(isSameDayDispatchDistrict('Wakiso')).toBe(true);
    expect(isSameDayDispatchDistrict('Mukono')).toBe(false);
  });

  it('the hero reads the zone from "Deliver to", not a guess', () => {
    expect(read('apps/api/src/infrastructure/Registry.ts')).toMatch(/new HeroSignalsService\(\(profileId\) => this\.getDeliverToUseCase\.execute/);
    expect(read('apps/api/src/application/hero/HeroContentService.ts')).toMatch(/outsideSameDayArea: signals\.zone \? !signals\.zone\.sameDay : false/);
  });
});

describe('capture points', () => {
  it('a fee view is recorded only for a known area and a human visitor', () => {
    const quote = read('apps/web/src/components/DeliveryQuote.astro');
    expect(quote).toMatch(/if \(q && record && \(areaSlug \|\| district\)\)/);
    expect(read('apps/web/src/pages/products/[slug].astro')).toMatch(/record=\{humanVisitor \? \{ surface: 'pdp' \} : null\}/);
  });
  it('the picker sends Locate me outcomes through our own origin, which adds the visitor token server-side', () => {
    expect(read('apps/web/src/lib/locationPickerClient.ts')).toMatch(/fetch\('\/location-signal'/);
    const relay = read('apps/web/src/pages/location-signal.ts');
    expect(relay).toMatch(/text\.length > 1000/);
    expect(read('apps/web/src/lib/locationSignals.ts')).toMatch(/h\['x-gp-visit'\] = visit/);
  });
});
