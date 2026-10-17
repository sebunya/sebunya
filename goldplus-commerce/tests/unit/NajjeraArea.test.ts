import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSearchText, foldUgandanOrthography } from '../../packages/shared/src/locations/folding';
import { bandForStraightKm } from '../../apps/api/src/domain/delivery/ParishCentroids';

/** Najjera as its own delivery area (0194, 2026-10-17). */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const sql = read('apps/api/src/infrastructure/db/migrations/0194_najjera_area.sql');
const hv = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

describe('Najjera, its own area', () => {
  it('every spelling customers type folds to the one alias the migration moves', () => {
    for (const s of ['Najjera', 'Najjeera', 'Najera', 'Najeera']) expect(foldUgandanOrthography(s)).toBe('najela');
    expect(sql).toContain("WHERE normalised_alias = 'najela' AND area_slug = 'wakiso-kira-31340'");
  });
  it('search text is built exactly as the gazetteer importer builds it', () => {
    expect(sql).toContain(`'${buildSearchText(['Najjera', 'Najjera', 'Wakiso', 'Kyadondo', 'Kira'])}'`);
  });
  it('the point is the OpenStreetMap village, nearer than Kira town, in the same band', () => {
    const shop = { lat: 0.31422, lng: 32.57792 };
    const najjera = { lat: 0.387308, lng: 32.625231 };
    const kira = { lat: 0.407132, lng: 32.637763 };
    expect(sql).toContain("0.387308, 32.625231, 'manual'");
    expect(sql).toContain("'osm:node/2099385069'");
    expect(hv(shop, najjera)).toBeCloseTo(9.68, 1);
    expect(hv(shop, kira) - hv(shop, najjera)).toBeGreaterThan(2.5);
    expect(bandForStraightKm(hv(shop, najjera))).toBe('B3');
  });
  it('idempotent and reversible, as written', () => {
    expect(sql.match(/ON CONFLICT \(area_slug\) DO NOTHING/g)).toHaveLength(2);
    expect(sql).toMatch(/Rollback: UPDATE ug_area_alias SET area_slug = 'wakiso-kira-31340'/);
  });
  it('the hand-placed points file carries it and the manifest pins the file', () => {
    const csv = read('data/geo/manual-points.csv');
    expect(csv).toMatch(/^wakiso-najjera-31340,0\.387308,32\.625231,800,osm:node\/2099385069,/m);
    const md5 = createHash('md5').update(readFileSync(new URL('../../data/geo/manual-points.csv', import.meta.url))).digest('hex');
    const rows = csv.split('\n').filter((l) => /^[a-z]+-[a-z0-9-]+,/.test(l)).length;
    expect(read('data/geo/MANIFEST.csv')).toContain(`manual-points.csv,manual-points,2026-10-17,${md5},${rows},`);
  });
});
