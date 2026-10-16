import { describe, expect, it } from 'vitest';
import { ceilingForCorridor, parseCorridorCeilings, resolveFulfilmentMode } from '../../apps/api/src/domain/delivery/DeliveryFulfilmentMode';
import { validateConfigValue } from '../../apps/api/src/domain/delivery/DeliveryConfigRegistry';
import { BusRateCardAdminUseCases, type IBusRateCardAdminRepository, type ParcelOfficeRow, type RateCardRow } from '../../apps/api/src/application/use-cases/delivery/BusRateCardAdminUseCases';

/** Owner, 2026-10-16: the rider's reach should be set per major road, and bus prices must be enterable. */
describe('per-road rider ceilings', () => {
  it('parses corridor=band pairs, refuses nonsense, and "none" means no per-road limits', () => {
    expect(parseCorridorCeilings('jinja_rd=B5, entebbe_rd=B4')).toEqual({ ok: true, ceilings: { jinja_rd: 'B5', entebbe_rd: 'B4' } });
    expect(parseCorridorCeilings('Jinja_Rd : b5')).toEqual({ ok: true, ceilings: { jinja_rd: 'B5' } });
    expect(parseCorridorCeilings('none')).toEqual({ ok: true, ceilings: {} });
    expect(parseCorridorCeilings('')).toEqual({ ok: true, ceilings: {} });
    expect(parseCorridorCeilings('jinja_rd=B9').ok).toBe(false);
    expect(parseCorridorCeilings('jinja_rd').ok).toBe(false);
    expect(parseCorridorCeilings('jinja_rd=B5, jinja_rd=B4').ok).toBe(false);
    expect(validateConfigValue('own_rider_max_band_by_corridor', 'jinja_rd=B5').ok).toBe(true);
    expect(validateConfigValue('own_rider_max_band_by_corridor', 'jinja road=B5').ok).toBe(false);
  });
  it('a listed road uses its own ceiling, every other road the shop-wide one', () => {
    const roads = { jinja_rd: 'B5', entebbe_rd: 'B3' } as const;
    expect(ceilingForCorridor('jinja_rd', 'B4', roads)).toBe('B5');
    expect(ceilingForCorridor('entebbe_rd', 'B4', roads)).toBe('B3');
    expect(ceilingForCorridor('hoima_rd', 'B4', roads)).toBe('B4');
    expect(ceilingForCorridor('hoima_rd', null, roads)).toBeNull();
    expect(ceilingForCorridor('jinja_rd', null, roads)).toBe('B5');
    const base = { accessMode: 'road' as const, serviceable: true, declaredMode: null };
    // Mukono town (B5, Jinja Road) is a rider stop when Jinja Road is allowed to B5 ...
    expect(resolveFulfilmentMode({ ...base, corridor: 'jinja_rd', band: 'B5' }, 'B4', roads)).toBe('own_rider');
    // ... while a B5 area on Hoima Road still ships by bus ...
    expect(resolveFulfilmentMode({ ...base, corridor: 'hoima_rd', band: 'B5' }, 'B4', roads)).toBe('bus_parcel');
    // ... and Entebbe Road is pulled in to B3, so Kitende (B4) goes by bus there.
    expect(resolveFulfilmentMode({ ...base, corridor: 'entebbe_rd', band: 'B4' }, 'B4', roads)).toBe('bus_parcel');
    // Without the map, behaviour is exactly as before.
    expect(resolveFulfilmentMode({ ...base, corridor: 'jinja_rd', band: 'B5' }, 'B4')).toBe('bus_parcel');
  });
});

function fakeRepo() {
  const cards: RateCardRow[] = [];
  const offices: ParcelOfficeRow[] = [];
  const repo: IBusRateCardAdminRepository = {
    listCards: async () => cards,
    supersedeCard: async (i) => {
      const prev = cards.filter((c) => c.carrier === i.carrier && c.destinationTown === i.destinationTown && c.parcelClass === i.parcelClass && c.effectiveTo === null);
      for (const p of prev) p.effectiveTo = i.now;
      const row: RateCardRow = { id: `c${cards.length + 1}`, carrier: i.carrier, destinationTown: i.destinationTown, destinationDistrict: i.destinationDistrict, parcelClass: i.parcelClass, feeUgx: i.feeUgx, insurancePctOfDeclaredValue: i.insurancePctOfDeclaredValue, transitDaysMin: i.transitDaysMin, transitDaysMax: i.transitDaysMax, chargedAt: i.chargedAt, effectiveFrom: i.now, effectiveTo: null, version: prev.length + cards.filter((c) => c.carrier === i.carrier && c.destinationTown === i.destinationTown && c.parcelClass === i.parcelClass && c.effectiveTo !== null).length ? 2 : 1, sourceNote: i.sourceNote };
      cards.push(row);
      return row;
    },
    expireCard: async (id, now) => {
      const c = cards.find((x) => x.id === id && x.effectiveTo === null);
      if (!c) return false;
      c.effectiveTo = now;
      return true;
    },
    listOffices: async () => offices,
    upsertOffice: async (i) => {
      const o = { id: `o${offices.length + 1}`, ...i };
      offices.push(o);
      return o;
    },
    setOfficeActive: async (id, active) => {
      const o = offices.find((x) => x.id === id);
      if (!o) return false;
      o.active = active;
      return true;
    },
  };
  return { repo, cards, offices };
}

describe('bus rate cards, entered by a person', () => {
  it('one destination, up to three prices; a blank class is not a price; a new price supersedes the old card', async () => {
    const { repo, cards } = fakeRepo();
    const uc = new BusRateCardAdminUseCases(repo);
    const first = await uc.setPrices({ carrier: 'Link Bus', destinationTown: 'Mukono', destinationDistrict: 'mukono', fees: { small: 8000, medium: 12000, large: null }, insurancePctOfDeclaredValue: null, transitDaysMin: 0, transitDaysMax: 1, chargedAt: 'collection', sourceNote: 'agreed at the Namayiba office', actorId: 'u1', now: new Date('2026-10-16T05:00:00Z') });
    expect(first.ok && first.cards.map((c) => [c.parcelClass, c.feeUgx, c.destinationDistrict])).toEqual([['small', 8000, 'Mukono'], ['medium', 12000, 'Mukono']]);
    const again = await uc.setPrices({ carrier: 'Link Bus', destinationTown: 'Mukono', destinationDistrict: 'Mukono', fees: { small: 9000 }, insurancePctOfDeclaredValue: 1.5, transitDaysMin: 0, transitDaysMax: 1, chargedAt: 'collection', sourceNote: null, actorId: 'u1', now: new Date('2026-10-20T05:00:00Z') });
    expect(again.ok).toBe(true);
    const small = cards.filter((c) => c.parcelClass === 'small');
    expect(small).toHaveLength(2);
    expect(small[0].effectiveTo).toEqual(new Date('2026-10-20T05:00:00Z'));
    expect(small[1].effectiveTo).toBeNull();
    expect(small[1].feeUgx).toBe(9000);
  });
  it('refuses what cannot be a negotiated price', async () => {
    const uc = new BusRateCardAdminUseCases(fakeRepo().repo);
    const base = { carrier: 'Link Bus', destinationTown: 'Gulu', destinationDistrict: 'Gulu', insurancePctOfDeclaredValue: null, transitDaysMin: 1, transitDaysMax: 2, chargedAt: 'sending', sourceNote: null, actorId: null };
    expect((await uc.setPrices({ ...base, fees: {} })).ok).toBe(false);
    expect((await uc.setPrices({ ...base, fees: { small: 10.5 } })).ok).toBe(false);
    expect((await uc.setPrices({ ...base, fees: { small: 10000 }, destinationDistrict: 'Narnia' })).ok).toBe(false);
    expect((await uc.setPrices({ ...base, fees: { small: 10000 }, chargedAt: 'later' })).ok).toBe(false);
    expect((await uc.setPrices({ ...base, fees: { small: 10000 }, transitDaysMin: 3, transitDaysMax: 1 })).ok).toBe(false);
    expect((await uc.setPrices({ ...base, fees: { small: 10000 } })).ok).toBe(true);
  });
  it('a parcel office needs carrier, name, town and a real district; switching off keeps it', async () => {
    const { repo, offices } = fakeRepo();
    const uc = new BusRateCardAdminUseCases(repo);
    expect((await uc.setOffice({ carrier: 'Link Bus', name: 'Link Gulu office', town: 'Gulu', district: 'gulu', physicalAddress: null, landmarkText: 'opposite the main market', phone: null, departureTimes: null, collectionWindow: null })).ok).toBe(true);
    expect(offices[0].district).toBe('Gulu');
    expect((await uc.setOffice({ carrier: 'X', name: 'Y', town: 'Z', district: 'Nowhere', physicalAddress: null, landmarkText: null, phone: null, departureTimes: null, collectionWindow: null })).ok).toBe(false);
    expect((await uc.setOfficeActive('o1', false)).ok).toBe(true);
    expect(offices[0].active).toBe(false);
  });
});
