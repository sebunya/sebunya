import { describe, it, expect } from 'vitest';
import {
  LocationSearchService,
  LOCATION_SEARCH_RESULT_CAP,
} from '../../apps/api/src/application/services/locations/LocationSearchService';
import {
  AreaSearchHit,
  ILocationSearchRepository,
  ILocationOrderDensityReader,
  PickupPointSearchHit,
} from '../../apps/api/src/application/ports/ILocationSearch';
import { foldUgandanOrthography as fold } from '../../packages/shared/src/locations/folding';

function area(
  slug: string,
  label: string,
  district: string,
  matchType: AreaSearchHit['matchType'],
  over: Partial<AreaSearchHit> = {},
): AreaSearchHit {
  return {
    kind: 'area',
    areaSlug: slug,
    displayLabel: label,
    areaName: label.split(' ·')[0],
    currentDistrict: district,
    deliveryZoneCode: null,
    postcode: null,
    isMetro: false,
    matchType,
    score: matchType === 'trigram' ? 0.5 : 1,
    ...over,
  };
}

class FakeRepo implements ILocationSearchRepository {
  alias: AreaSearchHit[] = [];
  exact: AreaSearchHit[] = [];
  groups: AreaSearchHit[] = [];
  prefixHits: AreaSearchHit[] = [];
  trigramHits: AreaSearchHit[] = [];
  landmarks: AreaSearchHit[] = [];
  pickups: PickupPointSearchHit[] = [];
  async aliasExact() { return this.alias; }
  async areaExact() { return this.exact; }
  async groupExact() { return this.groups; }
  async prefix() { return this.prefixHits; }
  async trigram() { return this.trigramHits; }
  async landmark() { return this.landmarks; }
  async pickupPoints() { return this.pickups; }
}

const noDensity: ILocationOrderDensityReader = { densityByArea: async () => new Map() };

describe('LocationSearchService — F.1 pipeline + F.3 ranking', () => {
  it('short queries return nothing and are not a zero-result miss', async () => {
    const svc = new LocationSearchService(new FakeRepo(), noDensity);
    const r = await svc.search('n');
    expect(r.hits).toEqual([]);
    expect(r.zeroResult).toBe(false);
  });

  it('best provenance wins the dedupe: alias_exact beats trigram for the same area', async () => {
    const repo = new FakeRepo();
    repo.alias = [area('najjera-wakiso', 'Najjera · Wakiso', 'Wakiso', 'alias_exact')];
    repo.trigramHits = [area('najjera-wakiso', 'Najjera · Wakiso', 'Wakiso', 'trigram')];
    const r = await new LocationSearchService(repo, noDensity).search('najjera');
    expect(r.hits).toHaveLength(1);
    expect((r.hits[0] as AreaSearchHit).matchType).toBe('alias_exact');
  });

  it('a group renders as ONE entry and shadows its member fragments (nsambya)', async () => {
    const repo = new FakeRepo();
    repo.groups = [
      area('nsambya-central-kampala', 'Nsambya', 'Kampala', 'group_exact', {
        groupId: 'g1',
        groupName: 'Nsambya',
        ...( { memberSlugs: ['nsambya-central-kampala', 'nsambya-railway-kampala', 'nsambya-police-kampala', 'nsambya-housing-kampala'] } as object),
      }),
    ];
    repo.exact = [
      area('nsambya-railway-kampala', 'Nsambya Railway · Kampala', 'Kampala', 'area_exact'),
      area('nsambya-police-kampala', 'Nsambya Police Barracks · Kampala', 'Kampala', 'area_exact'),
    ];
    const r = await new LocationSearchService(repo, noDensity).search('nsambya');
    expect(r.hits).toHaveLength(1);
    expect((r.hits[0] as AreaSearchHit).groupName).toBe('Nsambya');
  });

  it('two same-named areas in one district stay distinguishable via display_label', async () => {
    const repo = new FakeRepo();
    repo.exact = [
      area('kikandwa-a', 'Kikandwa · Mityana (Busujju)', 'Mityana', 'area_exact'),
      area('kikandwa-b', 'Kikandwa · Mityana (Kikandwa SC)', 'Mityana', 'area_exact'),
    ];
    const r = await new LocationSearchService(repo, noDensity).search('kikandwa');
    const labels = r.hits.map((h) => (h as AreaSearchHit).displayLabel);
    expect(new Set(labels).size).toBe(2);
  });

  it('ranking: saved beats ordered beats zone beats density beats quality', async () => {
    const repo = new FakeRepo();
    repo.prefixHits = [
      area('a-z4', 'Alpha · Far', 'Far', 'prefix', { deliveryZoneCode: 'Z4' }),
      area('b-z1', 'Beta · Kampala', 'Kampala', 'prefix', { deliveryZoneCode: 'Z1' }),
      area('c-saved', 'Gamma · Mid', 'Mid', 'prefix', { deliveryZoneCode: 'Z3' }),
      area('d-ordered', 'Delta · Mid', 'Mid', 'prefix', { deliveryZoneCode: 'Z3' }),
    ];
    const r = await new LocationSearchService(repo, noDensity).search('anything', {
      savedAreaSlugs: new Set(['c-saved']),
      orderedAreaSlugs: new Set(['d-ordered']),
    });
    expect(r.hits.map((h) => (h as AreaSearchHit).areaSlug)).toEqual([
      'c-saved',
      'd-ordered',
      'b-z1',
      'a-z4',
    ]);
  });

  it('order density breaks zone ties; quality breaks density ties; alphabetical last', async () => {
    const repo = new FakeRepo();
    repo.prefixHits = [
      area('low-density', 'Aaa · X', 'X', 'prefix', { deliveryZoneCode: 'Z2' }),
      area('high-density', 'Zzz · X', 'X', 'prefix', { deliveryZoneCode: 'Z2' }),
    ];
    repo.trigramHits = [area('same-zone-trigram', 'Bbb · X', 'X', 'trigram', { deliveryZoneCode: 'Z2', score: 0.5 })];
    const density: ILocationOrderDensityReader = {
      densityByArea: async () => new Map([['high-density', 12]]),
    };
    const r = await new LocationSearchService(repo, density).search('anything');
    expect(r.hits.map((h) => (h as AreaSearchHit).areaSlug)).toEqual([
      'high-density',
      'low-density',
      'same-zone-trigram',
    ]);
  });

  it('caps at 8 and pickup points are a distinct trailing result type', async () => {
    const repo = new FakeRepo();
    repo.prefixHits = Array.from({ length: 12 }, (_, i) =>
      area(`s${i}`, `Area${String.fromCharCode(65 + i)} · D`, 'D', 'prefix'),
    );
    repo.pickups = [
      { kind: 'pickup_point', pickupPointId: 'p1', name: 'Gateway Bus Office', operator: 'bus_parcel_office', areaSlug: null, district: null, matchType: 'pickup_point', score: 0.9 },
    ];
    const r = await new LocationSearchService(repo, noDensity).search('area');
    expect(r.hits).toHaveLength(LOCATION_SEARCH_RESULT_CAP);
    expect(r.hits.every((h) => h.kind === 'area')).toBe(true);
  });

  it('zero results at every layer flags a search miss', async () => {
    const r = await new LocationSearchService(new FakeRepo(), noDensity).search('atlantis');
    expect(r.zeroResult).toBe(true);
  });

  it('the query is folded before matching (matugga finds matuga-indexed data)', async () => {
    const repo = new FakeRepo();
    let received = '';
    repo.areaExact = async (f: string) => {
      received = f;
      return [];
    };
    await new LocationSearchService(repo, noDensity).search('Matugga');
    expect(received).toBe(fold('matuga'));
  });
});
