import { describe, expect, it } from 'vitest';
import { DISTRICT_LINEAGE, canonicalDistrictKey, lineageFamily, sameLineageFamily } from '../../packages/shared/src/locations/districtLineage';
import { normalizeUgandaDistrict } from '../../packages/shared/src/locations/uganda';
import {
  CorridorAreaRecord,
  ParishRecord,
  areaKindFor,
  bandForStraightKm,
  centroidSourceRef,
  classifyAgainstBand,
  diceBigram,
  expectedErrorMetres,
  fulfilmentFlip,
  matchKey,
  matchParishesToAreas,
  tokenKey,
} from '../../apps/api/src/domain/delivery/ParishCentroids';
import { parseCsv } from '../../apps/api/src/scripts/geo-import-parish-centroids';

/**
 * Address system spec, Phase A: the pure half of the parish centroid import.
 * The spelling variants below are the real Kampala misses measured on
 * 2026-10-15 (350/390 exact; the rest are these).
 */

let nextId = 1;
const parish = (district: string, subcounty: string, name: string, over: Partial<ParishRecord> = {}): ParishRecord => ({
  objectId: nextId++,
  district,
  county: 'X',
  subcounty,
  parish: name,
  pcode: `${district}${subcounty}${name}`.replace(/\s+/g, ''),
  lat: 0.33,
  lng: 32.6,
  areaKm2: 1.2,
  ...over,
});
const area = (slug: string, name: string, district: string, over: Partial<CorridorAreaRecord> = {}): CorridorAreaRecord => ({
  areaSlug: slug,
  area: name,
  district,
  subcounty: null,
  band: 'B2',
  ...over,
});
const match = (areas: CorridorAreaRecord[], parishes: ParishRecord[]) =>
  matchParishesToAreas(areas, parishes, { family: lineageFamily });

describe('district lineage families', () => {
  it('a district created after 2016 is one family with its parent and its siblings', () => {
    expect(lineageFamily('Kazo').has('KIRUHURA')).toBe(true);
    expect(lineageFamily('Kiruhura').has('KAZO')).toBe(true);
    expect(lineageFamily('Terego').has('MADI-OKOLLO')).toBe(true);
    expect(sameLineageFamily('Mbarara City', 'Rwampara')).toBe(true);
  });
  it('every lineage name is spelled the way the shop spells it (cities and proposals excepted)', () => {
    const wrong = DISTRICT_LINEAGE.flatMap((row) => {
      const out: string[] = [];
      const child = normalizeUgandaDistrict(row.child);
      const parent = normalizeUgandaDistrict(row.parent);
      if (!row.kind && !row.proposed && child !== row.child) out.push(`child ${row.child} → ${child ?? 'unknown'}`);
      if (parent !== row.parent) out.push(`parent ${row.parent} → ${parent ?? 'unknown'}`);
      return out;
    });
    expect(wrong).toEqual([]);
  });
  it("maps the 2016 file's own spellings onto the shop's before the family lookup", () => {
    expect(canonicalDistrictKey('KABONG')).toBe('KAABONG');
    expect(canonicalDistrictKey('kasanda')).toBe('KASSANDA');
    expect(lineageFamily('Karenga').has('KAABONG')).toBe(true);
    expect(lineageFamily('Kabong').has('KARENGA')).toBe(true);
    expect(lineageFamily('Kassanda').has('MUBENDE')).toBe(true);
  });
  it('a district nobody split is a family of one, and unknown names stay themselves', () => {
    expect([...lineageFamily('Kampala')]).toEqual(['KAMPALA']);
    expect([...lineageFamily('Wakiso')]).toEqual(['WAKISO']);
    expect(lineageFamily('Sembabule').has('KAMPALA')).toBe(false);
  });
});

describe('name keys', () => {
  it('drops the unit words and folds the orthography', () => {
    expect(matchKey('Ntaawo Ward')).toBe(matchKey('NTAAWO'));
    expect(matchKey('Nakivubo Shauliyako')).toBe(matchKey('NAKIVUBO-SHAURIYAKO'));
    expect(matchKey('Rubaga')).toBe(matchKey('LUBAGA'));
  });
  it('the same words in another order share a token key', () => {
    expect(tokenKey('University (Makerere)')).toBe(tokenKey('MAKERERE UNIVERSITY'));
  });
  it('Dice bigram similarity behaves', () => {
    expect(diceBigram('bugolobi', 'bugolobi')).toBe(1);
    expect(diceBigram('bogolobi', 'bugolobi')).toBeGreaterThan(0.6);
    expect(diceBigram('ntinda', 'kajjansi')).toBeLessThan(0.2);
    expect(diceBigram('', '')).toBe(1);
  });
});

describe('matching corridor areas to 2016 parishes', () => {
  it('exact, reordered and fuzzy spellings all land on the right parish, inside the district', () => {
    const parishes = [
      parish('KAMPALA', 'NAKAWA', 'NTINDA'),
      parish('KAMPALA', 'MAKINDYE', 'BUGOLOBI'),
      parish('KAMPALA', 'CENTRAL', 'CIVIC CENTER'),
      parish('KAMPALA', 'KAWEMPE', 'MAKERERE UNIVERSITY'),
      parish('KAMPALA', 'RUBAGA', 'NATETE'),
      parish('KAMPALA', 'KAWEMPE', 'KIKAAYA'),
      parish('WAKISO', 'KIRA', 'NTINDA'), // a same-named parish in another district must never be taken
    ];
    const out = match(
      [
        area('kampala-ntinda', 'Ntinda', 'Kampala'),
        area('kampala-bogolobi', 'Bogolobi', 'Kampala'),
        area('kampala-civic', 'Civic Centre', 'Kampala'),
        area('kampala-university', 'University (Makerere)', 'Kampala'),
        area('kampala-nateete', 'Nateete', 'Kampala'),
        area('kampala-kikaya', 'Kikaya', 'Kampala'),
      ],
      parishes,
    );
    const by = Object.fromEntries(out.matched.map((m) => [m.areaSlug, m]));
    expect(out.unmatched).toEqual([]);
    expect(out.ambiguous).toEqual([]);
    expect(by['kampala-ntinda'].method).toBe('exact');
    expect(by['kampala-ntinda'].parish.district).toBe('KAMPALA');
    expect(by['kampala-university'].method).toBe('tokens');
    expect(by['kampala-bogolobi'].parish.parish).toBe('BUGOLOBI');
    expect(by['kampala-civic'].parish.parish).toBe('CIVIC CENTER');
    expect(by['kampala-nateete'].parish.parish).toBe('NATETE');
    expect(by['kampala-kikaya'].parish.parish).toBe('KIKAAYA');
    // The orthography fold already equates some of these (doubled vowels, o/u);
    // the rest need the fuzzy step. Either way the score is real, never below the threshold.
    for (const slug of ['kampala-bogolobi', 'kampala-civic', 'kampala-nateete', 'kampala-kikaya']) {
      expect(['exact', 'fuzzy']).toContain(by[slug].method);
      expect(by[slug].score).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('matches inside the lineage family, never across districts', () => {
    const parishes = [parish('KIRUHURA', 'KAZO', 'KAZO TOWN COUNCIL'), parish('SEMBABULE', 'MATEETE', 'KAMPALA')];
    const out = match([area('kazo-kazo', 'Kazo Town Council', 'Kazo'), area('kampala-kampala', 'Kampala', 'Kampala')], parishes);
    expect(out.matched.map((m) => [m.areaSlug, m.parish.district])).toEqual([['kazo-kazo', 'KIRUHURA']]);
    expect(out.unmatched).toEqual(['kampala-kampala']);
  });

  it("a parish the 2016 file lists under KABONG matches an area the shop files under Karenga", () => {
    const out = match([area('karenga-kapedo', 'Kapedo', 'Karenga')], [parish('KABONG', 'KAPEDO', 'KAPEDO')]);
    expect(out.matched.map((m) => m.areaSlug)).toEqual(['karenga-kapedo']);
  });

  it('records how a point was placed in the source reference', () => {
    const p = parish('KAMPALA', 'NAKAWA', 'NTINDA');
    expect(centroidSourceRef({ parish: p, method: 'exact', score: 1 })).toBe(p.pcode);
    expect(centroidSourceRef({ parish: p, method: 'tokens', score: 0.95 })).toBe(`${p.pcode}#tokens`);
    expect(centroidSourceRef({ parish: p, method: 'fuzzy', score: 0.714 })).toBe(`${p.pcode}#fuzzy:0.71`);
  });

  it('two parishes of one name in a district: the sub-county decides, or the area is ambiguous', () => {
    const parishes = [parish('WAKISO', 'KIRA', 'NAMUGONGO'), parish('WAKISO', 'NANGABO', 'NAMUGONGO')];
    const withSub = match([area('w-namugongo', 'Namugongo', 'Wakiso', { subcounty: 'Kira' })], parishes);
    expect(withSub.matched[0]?.parish.subcounty).toBe('KIRA');
    const without = match([area('w-namugongo', 'Namugongo', 'Wakiso')], parishes);
    expect(without.matched).toEqual([]);
    expect(without.ambiguous[0]?.candidates).toHaveLength(2);
  });

  it('a fuzzy tie is ambiguous, not guessed', () => {
    const parishes = [parish('KAMPALA', 'A', 'KIBUYE I'), parish('KAMPALA', 'B', 'KIBUYE II')];
    const out = match([area('k-kibuye', 'Kibuye', 'Kampala')], parishes);
    expect(out.matched).toEqual([]);
    expect(out.ambiguous).toHaveLength(1);
  });

  it('several areas on one parish are flagged as sharing the polygon', () => {
    const parishes = [parish('MUKONO', 'GOMA', 'SEETA')];
    const out = match([area('m-seeta-a', 'Seeta', 'Mukono'), area('m-seeta-b', 'Seeta Ward', 'Mukono')], parishes);
    expect(out.matched).toHaveLength(2);
    expect(out.matched.every((m) => m.sharedPolygon)).toBe(true);
  });
});

describe('expected error, area kind, bands', () => {
  it('derives the error from the polygon size and never invents one', () => {
    expect(expectedErrorMetres(1.2)).toBe(412);
    expect(expectedErrorMetres(90.759)).toBe(3583);
    expect(expectedErrorMetres(0)).toBeNull();
    expect(expectedErrorMetres(Number.NaN)).toBeNull();
  });
  it('classifies the postcode rows that are not neighbourhoods', () => {
    expect(areaKindFor('Luzira Prisons')).toBe('institution');
    expect(areaKindFor('University (Makerere)')).toBe('institution');
    expect(areaKindFor('Nsambya Police Barracks')).toBe('barracks');
    expect(areaKindFor('Queen Elizabeth')).toBe('reserve');
    expect(areaKindFor('Mt. Elgon')).toBe('reserve');
    expect(areaKindFor('Lake Mburo')).toBe('reserve');
    expect(areaKindFor('Bussi Island')).toBe('island');
    expect(areaKindFor('Butta Ward')).toBe('ward');
    expect(areaKindFor('Ntinda')).toBe('neighbourhood');
    expect(areaKindFor('Kajjansi')).toBe('neighbourhood');
  });
  it('maps straight-line km to the band whose edges contain it', () => {
    expect(bandForStraightKm(0)).toBe('B0');
    expect(bandForStraightKm(1.99)).toBe('B0');
    expect(bandForStraightKm(2)).toBe('B1');
    expect(bandForStraightKm(15)).toBe('B4');
    expect(bandForStraightKm(69.9)).toBe('B6');
    expect(bandForStraightKm(70)).toBeNull();
    expect(bandForStraightKm(-1)).toBeNull();
  });
});

describe('agreement with the hand-assigned band', () => {
  it('consistent inside the band, inside the tolerance, or once the detour allowance is applied', () => {
    expect(classifyAgainstBand({ seededBand: 'B2', km: 7, method: 'exact', sharedPolygon: false }).verdict).toBe('consistent');
    expect(classifyAgainstBand({ seededBand: 'B2', km: 10.5, method: 'exact', sharedPolygon: false }).verdict).toBe('consistent'); // 9 + 2
    expect(classifyAgainstBand({ seededBand: 'B3', km: 7.5, method: 'exact', sharedPolygon: false }).verdict).toBe('consistent'); // ×1.3 = 9.75
  });
  it('a clean exact match far outside the band makes the BAND suspect; a fuzzy one makes the MATCH suspect', () => {
    const band = classifyAgainstBand({ seededBand: 'B1', km: 20, method: 'exact', sharedPolygon: false });
    expect(band.verdict).toBe('suspect_band');
    expect(band.bandAtKm).toBe('B4');
    expect(classifyAgainstBand({ seededBand: 'B1', km: 20, method: 'fuzzy', sharedPolygon: false }).verdict).toBe('suspect_match');
    expect(classifyAgainstBand({ seededBand: 'B1', km: 20, method: 'exact', sharedPolygon: true }).verdict).toBe('suspect_match');
  });
  it('says when a re-band would change who delivers', () => {
    expect(fulfilmentFlip('B3', 'B5', 'B4')).toBe('leaves_rider_range');
    expect(fulfilmentFlip('B5', 'B3', 'B4')).toBe('enters_rider_range');
    expect(fulfilmentFlip('B2', 'B3', 'B4')).toBeNull();
    expect(fulfilmentFlip('B2', 'B5', null)).toBeNull();
    expect(fulfilmentFlip('B2', null, 'B4')).toBeNull();
  });
});

describe('the CSV reader', () => {
  it('handles quoted commas, doubled quotes and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n1,2\n');
    expect(rows).toEqual([
      { a: 'x, y', b: 'say "hi"' },
      { a: '1', b: '2' },
    ]);
  });
});
