import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DISTRICT_LINEAGE, canonicalDistrictKey, createLineage, lineageFamily, sameLineageFamily } from '../../packages/shared/src/locations/districtLineage';
import { normalizeUgandaDistrict } from '../../packages/shared/src/locations/uganda';
import { parseCsv, parseCsvRows, csvField } from '../../packages/shared/src/csv';
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
  pointGuard,
  tokenKey,
  unitKey,
} from '../../apps/api/src/domain/delivery/ParishCentroids';

/**
 * Address system spec, Phase A: the pure half of the parish centroid import,
 * with the counter-examples the review board traced on 2026-10-15.
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
  it('the reviewed CSV under data/geo carries every row the constant has (the CSV is what the importer reads)', () => {
    const csv = parseCsv(readFileSync(resolve(__dirname, '../../data/geo/district-lineage.csv'), 'utf8'));
    const inCsv = new Set(csv.map((r) => `${r.child}<${r.parent}`));
    const missing = DISTRICT_LINEAGE.map((r) => `${r.child}<${r.parent}`).filter((k) => !inCsv.has(k));
    expect(missing).toEqual([]);
    expect(csv.filter((r) => r.status === 'proposed').map((r) => r.child).sort()).toEqual(['Bughendera', 'Kisoko', 'Mukuju', 'Mulanda', 'Tororo City']);
  });
  it('a lineage built from data rows behaves like the constant (so the CSV can replace it)', () => {
    const l = createLineage([{ child: 'Newtown', parent: 'Oldshire' }], { OLDSHYRE: 'OLDSHIRE' });
    expect(l.family('Oldshyre').has('NEWTOWN')).toBe(true);
    expect([...l.family('Elsewhere')]).toEqual(['ELSEWHERE']);
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
    expect(matchKey('Kasangati Town Council')).toBe(matchKey('KASANGATI T.C.'));
  });
  it('tells numbered parishes apart, however the numeral is written (the fold collapses II into I)', () => {
    expect(matchKey('Kibuye I I')).toBe(matchKey('KIBUYE II'));
    expect(matchKey('Kibuye I I')).not.toBe(matchKey('KIBUYE I'));
    expect(matchKey('Kololo I V')).toBe(matchKey('KOLOLO IV'));
    expect(matchKey('Nakasero I I I')).toBe(matchKey('NAKASERO III'));
    expect(matchKey('Bwaise 2')).toBe(matchKey('BWAISE II'));
  });
  it('joins dotted acronyms', () => {
    expect(matchKey('U.P.K')).toBe(matchKey('UPK'));
    expect(matchKey('I.T.E.K')).toBe(matchKey('ITEK'));
  });
  it('keeps the unit word as a tie-break key', () => {
    expect(unitKey('Gombe Ward')).toBe('ward');
    expect(unitKey('Gombe')).toBe('');
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
  it('exact, reordered and variant spellings all land on the right parish, inside the district', () => {
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
    for (const slug of ['kampala-bogolobi', 'kampala-civic', 'kampala-nateete', 'kampala-kikaya']) {
      expect(['exact', 'fuzzy']).toContain(by[slug].method);
      expect(by[slug].score).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('numbered parishes resolve to their own number, never to each other', () => {
    const parishes = [parish('KAMPALA', 'MAKINDYE', 'KIBUYE I'), parish('KAMPALA', 'MAKINDYE', 'KIBUYE II'), parish('KAMPALA', 'CENTRAL', 'KOLOLO IV'), parish('KAMPALA', 'CENTRAL', 'KOLOLO I')];
    const out = match([area('k-kibuye-2', 'Kibuye I I', 'Kampala'), area('k-kibuye-1', 'Kibuye I', 'Kampala'), area('k-kololo-4', 'Kololo I V', 'Kampala')], parishes);
    const by = Object.fromEntries(out.matched.map((m) => [m.areaSlug, [m.parish.parish, m.method]]));
    expect(by['k-kibuye-2']).toEqual(['KIBUYE II', 'exact']);
    expect(by['k-kibuye-1']).toEqual(['KIBUYE I', 'exact']);
    expect(by['k-kololo-4']).toEqual(['KOLOLO IV', 'exact']);
    expect(out.ambiguous).toEqual([]);
    // A bare name against numbered parishes is ambiguous, not guessed.
    expect(match([area('k-kololo', 'Kololo', 'Kampala')], parishes).ambiguous).toHaveLength(1);
  });

  it('"Gombe" and "Gombe Ward" are different parishes: the unit word breaks the tie', () => {
    const parishes = [parish('WAKISO', 'GOMBE DIVISION', 'GOMBE'), parish('WAKISO', 'WAKISO TOWN COUNCIL', 'GOMBE WARD')];
    const out = match([area('w-gombe', 'Gombe', 'Wakiso'), area('w-gombe-ward', 'Gombe Ward', 'Wakiso')], parishes);
    const by = Object.fromEntries(out.matched.map((m) => [m.areaSlug, m.parish.parish]));
    expect(by['w-gombe']).toBe('GOMBE');
    expect(by['w-gombe-ward']).toBe('GOMBE WARD');
  });

  it('a fuzzy match needs the score AND a shared start: Kazo Nabweru is not Nabweru North', () => {
    const parishes = [parish('WAKISO', 'NANSANA', 'KAZO WARD'), parish('WAKISO', 'NANSANA', 'NABWERU NORTH WARD'), parish('WAKISO', 'KIRA', 'NAMULONGE')];
    const out = match([area('w-kazo-nabweru', 'Kazo Nabweru', 'Wakiso'), area('w-namugongo', 'Namugongo', 'Wakiso')], parishes);
    expect(out.matched).toEqual([]);
    expect(out.unmatched.sort()).toEqual(['w-kazo-nabweru', 'w-namugongo']);
  });

  it("an area that is a parish's reference village takes that parish on the file's own evidence, before any fuzzy guess", () => {
    const kira = parish('WAKISO', 'KIRA', 'KIRA', { villageHq: 'NAJJERA' });
    const out = match([area('w-najjera', 'Najjera', 'Wakiso'), area('w-nowhere', 'Nowhere', 'Wakiso')], [kira, parish('WAKISO', 'KIRA', 'NAJJANANKUMBI')]);
    expect(out.matched.map((m) => [m.areaSlug, m.parish.parish, m.method])).toEqual([['w-najjera', 'KIRA', 'village']]);
    expect(centroidSourceRef(out.matched[0])).toBe(`${kira.objectId}:${kira.pcode}#village`);
    expect(out.unmatched).toEqual(['w-nowhere']);
  });

  it('short keys never fuzzy-match', () => {
    expect(match([area('x-lugo', 'Lugo', 'Kampala')], [parish('KAMPALA', 'A', 'LUGOBA')]).unmatched).toEqual(['x-lugo']);
  });

  it('matches inside the lineage family, never across districts', () => {
    const parishes = [parish('KIRUHURA', 'KAZO', 'KAZO TOWN COUNCIL'), parish('SEMBABULE', 'MATEETE', 'KAMPALA')];
    const out = match([area('kazo-kazo', 'Kazo Town Council', 'Kazo'), area('kampala-kampala', 'Kampala', 'Kampala')], parishes);
    expect(out.matched.map((m) => [m.areaSlug, m.parish.district])).toEqual([['kazo-kazo', 'KIRUHURA']]);
    expect(out.unmatched).toEqual(['kampala-kampala']);
  });

  it('a parish the 2016 file lists under KABONG matches an area the shop files under Karenga', () => {
    const out = match([area('karenga-kapedo', 'Kapedo', 'Karenga')], [parish('KABONG', 'KAPEDO', 'KAPEDO')]);
    expect(out.matched.map((m) => m.areaSlug)).toEqual(['karenga-kapedo']);
  });

  it('two parishes of one name in a district: the sub-county decides, or the area is ambiguous', () => {
    const parishes = [parish('WAKISO', 'KIRA', 'NAMUGONGO'), parish('WAKISO', 'NANGABO', 'NAMUGONGO')];
    const withSub = match([area('w-namugongo', 'Namugongo', 'Wakiso', { subcounty: 'Kira' })], parishes);
    expect(withSub.matched[0]?.parish.subcounty).toBe('KIRA');
    const without = match([area('w-namugongo', 'Namugongo', 'Wakiso')], parishes);
    expect(without.matched).toEqual([]);
    expect(without.ambiguous[0]?.candidates).toHaveLength(2);
  });

  it('several DISTINCT area names on one parish share the polygon; a duplicate postcode row of one name does not', () => {
    const seeta = parish('MUKONO', 'GOMA', 'SEETA');
    const shared = match([area('m-seeta', 'Seeta', 'Mukono'), area('m-seeta-ward', 'Seeta Ward', 'Mukono')], [seeta]);
    expect(shared.matched).toHaveLength(2);
    expect(shared.matched.every((m) => m.sharedPolygon)).toBe(true);
    const dup = match([area('k-kyanja-1', 'Kyanja', 'Kampala'), area('k-kyanja-2', 'Kyanja', 'Kampala')], [parish('KAMPALA', 'NAKAWA', 'KYANJA')]);
    expect(dup.matched.every((m) => !m.sharedPolygon)).toBe(true);
  });

  it('records how a point was placed in the source reference, keyed by the unique record id', () => {
    const p = parish('KAMPALA', 'NAKAWA', 'NTINDA');
    expect(centroidSourceRef({ parish: p, method: 'exact', score: 1 })).toBe(`${p.objectId}:${p.pcode}`);
    expect(centroidSourceRef({ parish: p, method: 'tokens', score: 0.95 })).toBe(`${p.objectId}:${p.pcode}#tokens`);
    expect(centroidSourceRef({ parish: p, method: 'fuzzy', score: 0.714 })).toBe(`${p.objectId}:${p.pcode}#fuzzy:0.71`);
  });
});

describe('expected error, point guard, area kind, bands', () => {
  it('derives a p90-comparable error from the polygon size and shape and never invents one', () => {
    expect(expectedErrorMetres(1.2)).toBe(587);
    expect(expectedErrorMetres(1.2, { w: 5.2, h: 2.4 })).toBe(1653); // an elongated Mutungo-shaped box
    expect(expectedErrorMetres(0)).toBeNull();
    expect(expectedErrorMetres(Number.NaN)).toBeNull();
  });
  it('refuses a centre that is in the lake or nowhere', () => {
    expect(pointGuard(parish('WAKISO', 'ENTEBBE', 'KIGUNGU WARD', { areaKm2: 203 }))).toBe('too_large');
    expect(pointGuard(parish('WAKISO', 'BUSSI', 'TEBANKIZA', { villageHq: 'WATER' }))).toBe('water_body');
    expect(pointGuard(parish('MUKONO', 'MPUNGE', 'LULAGWE', { villageHq: 'LAKE VICTORIA' }))).toBe('water_body');
    expect(pointGuard(parish('KAMPALA', 'MAKINDYE', 'GGABA', { areaKm2: 2, bbox: { s: 0.2, w: 32.6, n: 0.25, e: 32.65 } }))).toBe('sparse_polygon');
    expect(pointGuard(parish('KAMPALA', 'NAKAWA', 'NTINDA'))).toBe('ok');
  });
  it('classifies the postcode rows that are not neighbourhoods, and never a housing estate', () => {
    expect(areaKindFor('Luzira Prisons')).toBe('institution');
    expect(areaKindFor('University (Makerere)')).toBe('institution');
    expect(areaKindFor('Nsambya Police Barracks')).toBe('barracks');
    expect(areaKindFor('Queen Elizabeth')).toBe('reserve');
    expect(areaKindFor('Mt. Elgon')).toBe('reserve');
    expect(areaKindFor('Lake Mburo')).toBe('reserve');
    expect(areaKindFor('Bussi Island')).toBe('island');
    expect(areaKindFor('Butta Ward')).toBe('ward');
    expect(areaKindFor('Nsambya Estate')).toBe('neighbourhood');
    expect(areaKindFor('Kasangati T.C.')).toBe('neighbourhood');
    expect(areaKindFor('Ntinda')).toBe('neighbourhood');
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
  const clean = { method: 'exact' as const, sharedPolygon: false, expectedErrorM: 500 };
  it('consistent when the seeded band is the band at the km, or at the km times the detour allowance', () => {
    expect(classifyAgainstBand({ seededBand: 'B2', km: 7, ...clean }).verdict).toBe('consistent');
    expect(classifyAgainstBand({ seededBand: 'B3', km: 7.5, ...clean }).verdict).toBe('consistent'); // ×1.3 = 9.75
  });
  it('adjacent when the point is within its own error of the band edge, so nobody re-bands on noise', () => {
    expect(classifyAgainstBand({ seededBand: 'B2', km: 9.3, ...clean }).verdict).toBe('adjacent');
    expect(classifyAgainstBand({ seededBand: 'B2', km: 9.3, ...clean, expectedErrorM: 100 }).verdict).toBe('suspect_band'); // tolerance floor 250 m
    expect(classifyAgainstBand({ seededBand: 'B1', km: 5.2, ...clean }).verdict).toBe('adjacent'); // just past B1's far edge
    expect(classifyAgainstBand({ seededBand: 'B2', km: 4.8, ...clean }).verdict).toBe('consistent'); // the detour allowance explains a near point
  });
  it('a clean match far outside the band makes the BAND suspect; a weak fuzzy or shared one makes the MATCH suspect', () => {
    const band = classifyAgainstBand({ seededBand: 'B1', km: 20, ...clean });
    expect(band.verdict).toBe('suspect_band');
    expect(band.bandAtKm).toBe('B4');
    expect(classifyAgainstBand({ seededBand: 'B1', km: 20, method: 'fuzzy', score: 0.72, sharedPolygon: false }).verdict).toBe('suspect_match');
    expect(classifyAgainstBand({ seededBand: 'B1', km: 20, method: 'fuzzy', score: 0.9, sharedPolygon: false }).verdict).toBe('suspect_band');
    expect(classifyAgainstBand({ seededBand: 'B1', km: 20, method: 'exact', sharedPolygon: true }).verdict).toBe('suspect_match');
  });
  it('the detour allowance explains a point that is too near, never one that is too far', () => {
    expect(classifyAgainstBand({ seededBand: 'B1', km: 11, ...clean }).verdict).toBe('suspect_band'); // ×1.3 only moves it further
  });
  it('says when a re-band would change who delivers', () => {
    expect(fulfilmentFlip('B3', 'B5', 'B4')).toBe('leaves_rider_range');
    expect(fulfilmentFlip('B5', 'B3', 'B4')).toBe('enters_rider_range');
    expect(fulfilmentFlip('B2', 'B3', 'B4')).toBeNull();
    expect(fulfilmentFlip('B2', 'B5', null)).toBeNull();
    expect(fulfilmentFlip('B2', null, 'B4')).toBeNull();
  });
});

describe('the shared CSV grammar', () => {
  it('handles quoted commas, doubled quotes, CRLF, comment lines and the export formula guard', () => {
    expect(parseCsv('# provenance line\na,b\r\n"x, y","say ""hi"""\r\n1,2\n')).toEqual([
      { a: 'x, y', b: 'say "hi"' },
      { a: '1', b: '2' },
    ]);
    expect(parseCsvRows("k\n'-leading\n")).toEqual([['k'], ['-leading']]);
    expect(csvField('Kiwatule, Upper')).toBe('"Kiwatule, Upper"');
    expect(csvField('B2')).toBe('B2');
    expect(csvField(null)).toBe('');
  });
});
