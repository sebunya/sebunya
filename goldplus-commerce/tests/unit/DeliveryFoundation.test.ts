import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Stage A boundary (delivery brief v7). These pin the properties that make the
 * later stages safe: nothing invents a number, corridor and band cannot be
 * absent, and the calibration capture — including rider cost, which Rob moved
 * into this stage — exists before the first delivery rather than after it.
 */

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const migration = read('apps/api/src/infrastructure/db/migrations/0092_delivery_estimation_foundation.sql');
const schema = read('apps/api/src/infrastructure/db/schema/delivery.ts');
const importer = read('apps/api/src/scripts/import-delivery.ts');
const journal = read('apps/api/src/infrastructure/db/migrations/meta/_journal.json');

describe('migration 0092', () => {
  it('is registered and additive', () => {
    expect(journal).toContain('0092_delivery_estimation_foundation');
    const executable = migration
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(executable).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(executable).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(executable).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('makes a metro area without a corridor or band unreachable, not merely checked', () => {
    // PART 9 #9. NOT NULL in the schema is what makes this structural.
    const block = migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS "delivery_corridor"'));
    expect(block).toMatch(/"corridor" varchar\(40\) NOT NULL/);
    expect(block).toMatch(/"distance_band" varchar\(4\) NOT NULL/);
    expect(schema).toContain("corridor: varchar('corridor', { length: 40 }).notNull()");
  });

  it('constrains bands to B0-B6 — the retired CORE-REMOTE scheme cannot reappear', () => {
    expect(migration).toMatch(/"distance_band" in \('B0','B1','B2','B3','B4','B5','B6'\)/);
    for (const legacy of ['CORE', 'METRO_EDGE', 'REMOTE']) {
      expect(migration).not.toContain(`'${legacy}'`);
    }
  });

  it('captures actual rider cost — moved into stage A because PART 4 is dead without it', () => {
    expect(migration).toContain('"actual_rider_cost_ugx" bigint');
    expect(schema).toContain("actualRiderCostUgx: bigint('actual_rider_cost_ugx'");
    // NULL means "not known yet"; zero would be a measurement.
    expect(migration).toMatch(/"actual_rider_cost_ugx" IS NULL OR "actual_rider_cost_ugx" >= 0/);
  });

  it('ships every learned factor at 1.0 with a sample size, so a placeholder is visible', () => {
    expect(migration).toMatch(/"value" numeric\(8,4\) DEFAULT 1\.0 NOT NULL/);
    expect(migration).toMatch(/"sample_size" integer DEFAULT 0 NOT NULL/);
    expect(migration).toMatch(/"origin" varchar\(16\) DEFAULT 'prior' NOT NULL/);
  });

  it('records whether a live value came from a human or the model', () => {
    expect(migration).toMatch(/"origin" in \('human', 'model_proposed'\)/);
  });

  it('cannot publish a config version without a publisher, a time and a reason', () => {
    expect(migration).toMatch(
      /"status" <> 'published' OR \("published_by" IS NOT NULL AND "published_at" IS NOT NULL AND "reason" IS NOT NULL\)/,
    );
  });

  it('stores coordinates as numeric so 32.57750 round-trips exactly', () => {
    expect(migration).toMatch(/"latitude" numeric\(9,6\) NOT NULL/);
    expect(migration).toMatch(/"longitude" numeric\(9,6\) NOT NULL/);
    expect(migration).not.toMatch(/"latitude"\s+(real|double precision|float)/i);
  });

  it('seeds no fee, no factor override and none of the six launch values', () => {
    // No INSERT anywhere: this migration creates structure, never numbers.
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i);
  });
});

describe('the importer', () => {
  it('is MD5-gated on all four files', () => {
    for (const f of [
      'goldplus_delivery_origins.csv',
      'goldplus_delivery_corridors.csv',
      'goldplus_alias_corridors.csv',
      'uganda_name_collisions.csv',
    ]) {
      expect(importer).toContain(f);
    }
    expect(importer).toContain('55b8632890c7d670a6b023da098b806e'); // Rob's collisions checksum
    expect(importer).toContain('checksum mismatch');
  });

  it('asserts the row counts 1 / 362 / 28 / 84 and treats each as fatal', () => {
    expect(importer).toMatch(/'goldplus_delivery_origins\.csv': 1/);
    expect(importer).toMatch(/'goldplus_delivery_corridors\.csv': 362/);
    expect(importer).toMatch(/'goldplus_alias_corridors\.csv': 28/);
    expect(importer).toMatch(/'uganda_name_collisions\.csv': 84/);
    expect(importer).toContain('rows, expected');
  });

  it('validates the origin coordinate before it can reach the database', () => {
    expect(importer).toContain('validateOriginCoordinates');
    expect(importer).toContain('origin ${o[\'origin_code\']} rejected');
  });

  it('refuses a corridor row with no corridor or band, naming the row', () => {
    expect(importer).toContain("has no corridor and/or band");
  });

  it('checks every slug against the gazetteer rather than trusting the file', () => {
    expect(importer).toContain('select area_slug from ug_area');
    expect(importer).toContain('not in the gazetteer');
  });

  it('asserts the final row counts against the database, not just the files', () => {
    expect(importer).toContain("await check('delivery_corridor', 362)");
    expect(importer).toContain("await check('delivery_name_collision', 84)");
  });
});

describe('the data files, when present', () => {
  const dir = resolve(root, 'data/locations/v2');
  const has = existsSync(resolve(dir, 'uganda_name_collisions.csv'));

  it.skipIf(!has)('carries 84 collisions in the three declared classes', () => {
    const rows = readFileSync(resolve(dir, 'uganda_name_collisions.csv'), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(1);
    expect(rows).toHaveLength(84);
    const counts = rows.reduce<Record<string, number>>((acc, line) => {
      const type = line.split(',')[0];
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.AREA_NAME_MATCHES_OTHER_DISTRICT).toBe(38);
    expect(counts.SUBCOUNTY_NAME_MATCHES_OTHER_DISTRICT).toBe(18);
    expect(counts.AREA_NAME_MATCHES_OWN_DISTRICT).toBe(28);
  });

  it.skipIf(!has)('has exactly 12 water areas, which are pickup-only in phase 1', () => {
    const rows = readFileSync(resolve(dir, 'goldplus_delivery_corridors.csv'), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(1);
    expect(rows.filter((r) => r.includes(',water,'))).toHaveLength(12);
  });
});
