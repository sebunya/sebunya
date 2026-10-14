import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSearchText, foldUgandanOrthography } from '../../packages/shared/src/locations/folding';

/**
 * The same place name exists in more than one district. The alias and exact lookups took `limit 1` with no order,
 * so which area (and so which fee) a name resolved to was up to the planner: the page's quote and the order's
 * charge could disagree. Real PostgreSQL: two selectable areas share a made-up name; the metro one wins, every time.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('area text lookups are deterministic (real PostgreSQL)', () => {
  let raw: any; let resolver: any;
  const name = `zqx${Date.now().toString(36)}`;
  const slugs = [`zz-${name}-b-rural`, `aa-${name}-a-metro`, `mm-${name}-c-rural`];

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    const rows: Array<[string, string, boolean]> = [[slugs[0], 'Mukono', false], [slugs[1], 'Wakiso', true], [slugs[2], 'Luwero', false]];
    for (const [slug, district, metro] of rows) {
      await raw`insert into ug_area (area_slug, parish_or_area_clean, display_label, current_district, search_text, data_version, selectable, is_metro)
        values (${slug}, ${name}, ${`${name}, ${district}`}, ${district}, ${buildSearchText([name, district])}, 1, true, ${metro})`;
    }
    const { DeliveryAreaResolver } = await import('../../apps/api/src/infrastructure/delivery/DeliveryAreaResolver');
    resolver = new DeliveryAreaResolver();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from ug_area_alias where area_slug = any(${slugs})`;
    await raw`delete from ug_area where area_slug = any(${slugs})`;
    await raw.end({ timeout: 5 });
  });

  it('an exact name in several districts resolves to the metro area, every time', async () => {
    const picks = new Set<string>();
    for (let i = 0; i < 5; i++) picks.add((await resolver.byText(name, null))?.input.areaSlug);
    expect([...picks]).toEqual([slugs[1]]);
  });

  it('an alias shared by several areas resolves the same way', async () => {
    const alias = `${name}al`;
    for (const slug of slugs) {
      // Stored folded, as the import writes it (Ugandan spellings fold, e.g. r and l).
      await raw`insert into ug_area_alias (alias, normalised_alias, area_slug, confidence, source) values (${alias}, ${foldUgandanOrthography(alias)}, ${slug}, 'high', 'manual')`;
    }
    const r = await resolver.byText(alias, null);
    expect(r?.input.areaSlug).toBe(slugs[1]);
    expect(r?.via).toBe('alias');
  });

  it('a district filter still wins over metro', async () => {
    expect((await resolver.byText(name, 'Luwero'))?.input.areaSlug).toBe(slugs[2]);
  });
});
