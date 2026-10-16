import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * Real PostgreSQL: misses resolved to one area by three visitors become a landmark the search then finds; an alias
 * hit carries the gazetteer's spelling.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('landmark learning and alias spelling (real PostgreSQL)', () => {
  let raw: any;
  const tag = randomUUID().slice(0, 6);
  const slug = `test-lm-${tag}`;
  const word = `zzparliament${tag}`;
  const alias = `Najjjera${tag}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    await raw`insert into ug_area (area_slug, parish_or_area_clean, display_label, current_district, search_text, data_version, selectable, is_metro)
      values (${slug}, ${`Lm Central ${tag}`}, ${`Lm Central ${tag}, Kampala`}, 'Kampala', ${`lm central ${tag} kampala`}, 1, true, true)`;
    const { foldUgandanOrthography } = await import('../../packages/shared/src/locations/folding');
    await raw`insert into ug_area_alias (alias, normalised_alias, area_slug, confidence, source) values (${alias}, ${foldUgandanOrthography(alias)}, ${slug}, 'exact', 'seeded')`;
    for (const s of ['v1', 'v2', 'v3']) {
      await raw`insert into ug_search_miss (raw_query, normalised_query, session_id, result_count, resolved_area_slug, resolved_via)
        values (${word}, ${word}, ${`${tag}${s}`}, 0, ${slug}, 'landmark')`;
    }
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from ug_landmark where area_slug = ${slug}`;
    await raw`delete from ug_search_miss where resolved_area_slug = ${slug}`;
    await raw`delete from ug_area_alias where area_slug = ${slug}`;
    await raw`delete from ug_area where area_slug = ${slug}`;
    await raw.end({ timeout: 5 });
  });

  it('learns the landmark once, and the search then finds it', async () => {
    const { learnLandmarksNightly } = await import('../../apps/api/src/scripts/geo-nightly-learn-landmarks');
    const first = await learnLandmarksNightly();
    expect(first.added.find((a) => a.areaSlug === slug)).toMatchObject({ visitors: 3 });
    const again = await learnLandmarksNightly();
    expect(again.added.find((a) => a.areaSlug === slug)).toBeUndefined();
    const { DrizzleLocationSearchRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleLocationSearchRepository');
    const repo = new DrizzleLocationSearchRepository();
    const hits = await repo.landmark(word, 5);
    expect(hits[0]).toMatchObject({ areaSlug: slug, matchType: 'landmark' });
  });

  it('an alias hit carries the gazetteer spelling', async () => {
    const { DrizzleLocationSearchRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleLocationSearchRepository');
    const { foldUgandanOrthography } = await import('../../packages/shared/src/locations/folding');
    const repo = new DrizzleLocationSearchRepository();
    const exact = await repo.aliasExact(foldUgandanOrthography(alias));
    expect(exact.find((h) => h.areaSlug === slug)?.viaAlias).toBe(alias);
    const prefix = await repo.prefix(foldUgandanOrthography(alias).slice(0, -1), 50);
    expect(prefix.some((h) => h.areaSlug === slug)).toBe(true);
  });
});
