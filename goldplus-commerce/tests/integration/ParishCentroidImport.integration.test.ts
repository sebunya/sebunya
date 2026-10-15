import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildSearchText } from '../../packages/shared/src/locations/folding';

/**
 * Address system spec, Phase A: the parish centroid import against a real
 * PostgreSQL (migration 0189 layered by scripts/integration-env.sh).
 *
 * Seeds its own corridor areas, parishes and origin under a unique prefix and
 * removes them. Proves: a matched area gets the centroid and its expected
 * error; a 'manual' centroid is never overwritten; an unmatched area is left
 * alone; area_kind is set from the name; a second run changes nothing; and
 * the resolver then reports the km on the quote input.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('parish centroid import (real PostgreSQL)', () => {
  let raw: any;
  const tag = `zqx${Date.now().toString(36)}`;
  const slugs = {
    ntinda: `kampala-${tag}-ntinda`,
    prisons: `kampala-${tag}-luzira-prisons`,
    manual: `kampala-${tag}-manualville`,
    nowhere: `kampala-${tag}-nowhere`,
  };
  const originCode = `ZQX-${tag}`.toUpperCase().slice(0, 40);
  let csvPath: string;
  let importer: typeof import('../../apps/api/src/scripts/geo-import-parish-centroids');

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });

    const areas: Array<[string, string]> = [
      [slugs.ntinda, `${tag} Ntinda`],
      [slugs.prisons, `${tag} Luzira Prisons`],
      [slugs.manual, `${tag} Manualville`],
      [slugs.nowhere, `${tag} Nowhere`],
    ];
    for (const [slug, name] of areas) {
      await raw`insert into ug_area (area_slug, parish_or_area_clean, display_label, current_district, subcounty_or_division, search_text, data_version, selectable, is_metro)
        values (${slug}, ${name}, ${`${name}, Kampala`}, 'Kampala', 'Nakawa', ${buildSearchText([name, 'Kampala'])}, 1, true, true)`;
      await raw`insert into delivery_corridor (area_slug, district, sub_county_or_division, area, corridor, distance_band, access_mode, serviceable, data_version)
        values (${slug}, 'Kampala', 'Nakawa', ${name}, 'NTINDA', 'B2', 'road', true, 1)`;
    }
    await raw`update delivery_corridor set centroid_lat = 0.300000, centroid_lng = 32.600000, centroid_source = 'manual' where area_slug = ${slugs.manual}`;
    await raw`insert into delivery_origin (origin_code, name, role, latitude, longitude, active)
      values (${originCode}, 'Test hub', 'primary_dispatch_hub', 0.314220, 32.577920, true)`;

    const dir = mkdtempSync(join(tmpdir(), 'parish-centroids-'));
    csvPath = join(dir, 'parishes.csv');
    const header = 'objectid,district,county,subcounty,parish,village_hq,pcode,lat,lng,area_km2,bbox_s,bbox_w,bbox_n,bbox_e';
    const row = (id: number, name: string, lat: number, lng: number, km2: number) =>
      `${id},KAMPALA,KAMPALA,NAKAWA,${name},HQ,KAMPALAKAMPALANAKAWA${name.replace(/\s+/g, '')},${lat},${lng},${km2},0,0,0,0`;
    writeFileSync(
      csvPath,
      [
        header,
        row(1, `${tag.toUpperCase()} NTINDA`, 0.3467, 32.6181, 1.2),
        row(2, `${tag.toUpperCase()} LUZIRA PRISONS`, 0.3, 32.65, 0.5),
        row(3, `${tag.toUpperCase()} MANUALVILLE`, 0.35, 32.55, 2),
      ].join('\n') + '\n',
    );
    importer = await import('../../apps/api/src/scripts/geo-import-parish-centroids');
  });

  afterAll(async () => {
    if (!raw) return;
    const all = Object.values(slugs);
    await raw`delete from delivery_corridor where area_slug = any(${all})`;
    await raw`delete from ug_area where area_slug = any(${all})`;
    await raw`delete from delivery_origin where origin_code = ${originCode}`;
    await raw.end({ timeout: 5 });
  });

  it('a dry run matches and reports but writes nothing', async () => {
    const lines: string[] = [];
    const summary = await importer.runParishCentroidImport({ csvPath, apply: false, expectedMd5: null, expectedRows: null, log: (l) => lines.push(l) });
    expect(summary.applied).toBeNull();
    const rows = await raw`select centroid_source from delivery_corridor where area_slug = ${slugs.ntinda}`;
    expect(rows[0].centroid_source).toBeNull();
    expect(lines.some((l) => l.includes('DRY RUN'))).toBe(true);
  });

  it('--apply stores the centroid with its expected error, protects manual, leaves the unmatched alone, sets area_kind, writes the re-band file', async () => {
    const rebandCsvPath = join(dirname(csvPath), 'reband.csv');
    const summary = await importer.runParishCentroidImport({
      csvPath, apply: true, expectedMd5: null, expectedRows: null, ownRiderMaxBand: 'B4', rebandCsvPath, log: () => undefined,
    });
    expect(summary.applied?.added).toBe(2);
    expect(summary.applied?.protectedRows).toBe(1);

    // The re-band proposal is the corridor table in the Control Centre's CSV shape; nothing here was suspect, so our row keeps B2.
    const reband = readFileSync(rebandCsvPath, 'utf8').split('\n');
    expect(reband[0]).toBe('area_slug,postcode,delivery_zone,district,sub_county_or_division,area,corridor,distance_band,access_mode,serviceable,fulfilment_mode');
    const ours = reband.find((l) => l.startsWith(`${slugs.ntinda},`))!;
    expect(ours).toBeDefined();
    expect(ours.split(',')[7]).toBe('B2');

    const ntinda = (await raw`select centroid_lat, centroid_lng, centroid_source, centroid_source_ref, centroid_expected_error_m, centroid_shared_polygon from delivery_corridor where area_slug = ${slugs.ntinda}`)[0];
    expect(Number(ntinda.centroid_lat)).toBeCloseTo(0.3467, 4);
    expect(Number(ntinda.centroid_lng)).toBeCloseTo(32.6181, 4);
    expect(ntinda.centroid_source).toBe('parish_centroid');
    expect(ntinda.centroid_source_ref).toContain('NTINDA');
    expect(ntinda.centroid_source_ref).not.toContain('#'); // an exact match carries the bare PCODE; fuzzy ones carry the method and score
    expect(ntinda.centroid_expected_error_m).toBe(412);
    expect(ntinda.centroid_shared_polygon).toBe(false);

    const manual = (await raw`select centroid_lat, centroid_source from delivery_corridor where area_slug = ${slugs.manual}`)[0];
    expect(manual.centroid_source).toBe('manual');
    expect(Number(manual.centroid_lat)).toBeCloseTo(0.3, 4);

    const nowhere = (await raw`select centroid_lat, centroid_source from delivery_corridor where area_slug = ${slugs.nowhere}`)[0];
    expect(nowhere.centroid_source).toBeNull();
    expect(nowhere.centroid_lat).toBeNull();

    const kinds = await raw`select area_slug, area_kind from ug_area where area_slug = any(${Object.values(slugs)}) order by area_slug`;
    const kindOf = Object.fromEntries(kinds.map((k: any) => [k.area_slug, k.area_kind]));
    expect(kindOf[slugs.prisons]).toBe('institution');
    expect(kindOf[slugs.ntinda]).toBe('neighbourhood');

    const report = summary.rows.find((r) => r.areaSlug === slugs.ntinda)!;
    expect(report.km).toBeGreaterThan(5);
    expect(report.km).toBeLessThan(7);
    expect(report.verdict).toBe('consistent');
  });

  it('a second --apply changes nothing', async () => {
    const summary = await importer.runParishCentroidImport({ csvPath, apply: true, expectedMd5: null, expectedRows: null, log: () => undefined });
    expect(summary.applied).toEqual({ added: 0, changed: 0, unchanged: 2, protectedRows: 1, kinds: 0 });
  });

  it('the resolver now carries the km to the point, and leaves measuredKm for the registry to decide', async () => {
    const { DeliveryAreaResolver } = await import('../../apps/api/src/infrastructure/delivery/DeliveryAreaResolver');
    const resolved = await new DeliveryAreaResolver().bySlug(slugs.ntinda);
    expect(resolved?.input.centroidSource).toBe('parish_centroid');
    expect(resolved?.input.centroidKm).toBeGreaterThan(5);
    expect(resolved?.input.centroidKm).toBeLessThan(7);
    expect(resolved?.input.centroidExpectedErrorM).toBe(412);
    expect(resolved?.input.measuredKm).toBeNull();
  });

  it('refuses a data file with the wrong checksum', async () => {
    await expect(importer.runParishCentroidImport({ csvPath, apply: false, expectedMd5: 'not-the-file', expectedRows: null, log: () => undefined })).rejects.toThrow(/checksum/);
  });
});
