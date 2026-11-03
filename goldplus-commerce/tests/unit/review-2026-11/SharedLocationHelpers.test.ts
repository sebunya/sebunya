import { describe, it, expect } from 'vitest';
import { deliveryPointKm, districtRoadKm } from '../../../packages/shared/src/locations/uganda-geo';
import { sameDayAreaLine, popularNearYouCopy } from '../../../packages/shared/src/locations/locationCopy';
import { foldUgandanOrthography } from '../../../packages/shared/src/locations/folding';
import { normalizeUgandaDistrict } from '../../../packages/shared/src/locations/uganda';
import { sameLineageFamily, canonicalDistrictKey } from '../../../packages/shared/src/locations/districtLineage';

describe('uganda-geo lookups', () => {
  it('inherited keys are never a distance', () => {
    expect(districtRoadKm('toString')).toBeNull();
    expect(districtRoadKm('constructor')).toBeNull();
    expect(deliveryPointKm('Wakiso', 'constructor')).toBe(districtRoadKm('Wakiso'));
  });
  it('case-insensitive', () => {
    expect(districtRoadKm('wakiso')).toBe(districtRoadKm('Wakiso'));
    expect(deliveryPointKm('Wakiso', 'najjera')).toBe(deliveryPointKm('Wakiso', 'Najjera'));
    expect(deliveryPointKm('Wakiso', 'Najjera')).not.toBeNull();
  });
});

describe('sameDayAreaLine', () => {
  it('a passed cut-off never claims minutes left', () => {
    for (const m of [0, -3, Number.NaN]) {
      const line = sameDayAreaLine('Najjera', m);
      expect(line).not.toMatch(/minutes left|Order in/);
      expect(line).toMatch(/has left/);
    }
  });
  it('minutes are whole', () => {
    expect(sameDayAreaLine('Najjera', 90.5)).toBe('Order in 1h 30m and it goes out to Najjera today');
    expect(sameDayAreaLine('Najjera', 12.7)).toBe('Only 12 minutes left for this to go out to Najjera today');
  });
});

describe('popularNearYouCopy', () => {
  it('district scope names the district', () => {
    expect(popularNearYouCopy('district', 'Najjera, Wakiso').title).toBe('Popular across Wakiso');
    expect(popularNearYouCopy('district', 'Wakiso').title).toBe('Popular across Wakiso');
    expect(popularNearYouCopy('area', 'Najjera, Wakiso').title).toBe('Popular in Najjera');
  });
});

describe('folding: vowel drop only before nasal + consonant', () => {
  it('keeps distinct names distinct', () => {
    expect(foldUgandanOrthography('Amuru')).not.toBe(foldUgandanOrthography('Muru'));
    expect(foldUgandanOrthography('Anaka')).not.toBe(foldUgandanOrthography('Naka'));
    expect(foldUgandanOrthography('Emali')).not.toBe(foldUgandanOrthography('Mali'));
  });
  it('still folds entebbe == ntebbe', () => {
    expect(foldUgandanOrthography('Entebbe')).toBe(foldUgandanOrthography('Ntebbe'));
  });
});

describe('one district-variant table', () => {
  it('the normaliser and the lineage agree', () => {
    expect(normalizeUgandaDistrict('Fort Portal')).toBe('Kabarole');
    expect(sameLineageFamily('Fort Portal', 'Kabarole')).toBe(true);
    for (const v of ['LUBAGA', 'KIKUBE', 'KATAWI', 'NTUGAMO', 'KABONG']) {
      expect(canonicalDistrictKey(v)).toBe(normalizeUgandaDistrict(v)!.toUpperCase());
    }
  });
  it('new districts and cities resolve to the district they were carved from', () => {
    expect(normalizeUgandaDistrict('Mukuju')).toBe('Tororo');
    expect(normalizeUgandaDistrict('Tororo City')).toBe('Tororo');
    expect(normalizeUgandaDistrict('Arua City')).toBe('Arua');
    expect(normalizeUgandaDistrict('Fort Portal City')).toBe('Kabarole');
    expect(normalizeUgandaDistrict('Kazo')).toBe('Kazo');
  });
});
