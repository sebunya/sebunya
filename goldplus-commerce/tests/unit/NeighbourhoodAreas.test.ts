import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSearchText, foldUgandanOrthography } from '../../packages/shared/src/locations/folding';

/** Neighbourhoods customers name become their own areas with their own points (0194, 2026-10-17). */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const sql = read('apps/api/src/infrastructure/db/migrations/0194_neighbourhood_areas.sql');
const rows = [...sql.matchAll(/^\s+\('([a-z0-9-]+)', '([^']+)', '([a-z]+)', '([a-z0-9-]+)', ([0-9.]+), ([0-9.]+), '(osm:[a-z]+\/\d+)', '([^']+)'\)/gm)]
  .map((m) => ({ slug: m[1], name: m[2], norm: m[3], parent: m[4], lat: +m[5], lng: +m[6], ref: m[7], search: m[8] }));
const csv = read('data/geo/manual-points.csv');
const hv = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

describe('neighbourhood areas (0194)', () => {
  it('sixteen, each a distinct new slug under its parish, from an OpenStreetMap place', () => {
    expect(rows).toHaveLength(16);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(16);
    for (const r of rows) {
      expect(r.slug).not.toBe(r.parent);
      expect(r.slug.split('-').pop()).toBe(r.parent.split('-').pop()); // the parish's postcode
    }
  });
  it('every point is the one in the hand-placed file (not the parish point it replaces)', () => {
    for (const r of rows) {
      const line = csv.split('\n').find((l) => l.startsWith(`${r.slug},`))!;
      expect(line, r.slug).toBeTruthy();
      const [, lat, lng, , ref] = line.split(',');
      expect([+lat, +lng, ref]).toEqual([r.lat, r.lng, r.ref]);
    }
  });
  it('the names customers type fold to the alias each row moves; search text is the importer\'s', () => {
    for (const r of rows) {
      expect(foldUgandanOrthography(r.name)).toBe(r.norm);
      expect(r.search.startsWith(buildSearchText([r.name]))).toBe(true);
    }
    for (const s of ['Najjera', 'Najjeera', 'Najera', 'Najeera']) expect(foldUgandanOrthography(s)).toBe('najela');
  });
  it('the measured distance the fee uses: Najjera 9.68 km (was Kira town, 12.29), Zana 6.99 (was Kitende, 13.97)', () => {
    const shop = { lat: 0.31422, lng: 32.57792 };
    const by = (n: string) => rows.find((r) => r.name === n)!;
    expect(hv(shop, by('Najjera'))).toBeCloseTo(9.68, 1);
    expect(hv(shop, by('Zana'))).toBeCloseTo(6.99, 1);
  });
  it('idempotent (temp table dropped first, ON CONFLICT, alias moved only from its parish) and reversible as written', () => {
    expect(sql).toContain('DROP TABLE IF EXISTS gp_0194_areas;');
    expect(sql.match(/ON CONFLICT \(area_slug\) DO NOTHING/g)).toHaveLength(2);
    expect(sql).toContain('WHERE a.normalised_alias = n.norm AND a.area_slug = n.parent');
    expect(sql).toMatch(/-- {3}DELETE FROM ug_area WHERE area_slug IN \('wakiso-bulenga-31436'/);
    expect(sql).toContain('fast-growing residential and commercial neighbourhood in Kira Municipality');
  });
  it('the manifest pins the points file', () => {
    const md5 = createHash('md5').update(readFileSync(new URL('../../data/geo/manual-points.csv', import.meta.url))).digest('hex');
    const n = csv.split('\n').filter((l) => /^[a-z]+-[a-z0-9-]+,/.test(l)).length;
    expect(n).toBe(46);
    expect(read('data/geo/MANIFEST.csv')).toContain(`manual-points.csv,manual-points,2026-10-17,${md5},${n},`);
  });
});
