import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Production has 0 compatibility mappings and every PDP rail is empty. This
 * proves the emptiness is the data, not the engine: one enabled, positive
 * mapping makes the reader emit; a disabled one, or an incompatible verdict,
 * must not — the finder and the mapping repository already refuse those, and
 * the recommendation reader did not (2026-09-12).
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

d('recommendation reader × compatibility mappings (real PostgreSQL)', () => {
  let raw: any; let reader: any; let catId: string; const ids: string[] = [];
  const mk = async (tag: string) => {
    const sku = `CM-${tag}-${Date.now().toString(36)}`;
    const [p] = await raw`insert into products (sku, model_number, name, slug, category_id, price_ugx, active, approval_status, stock_status, stock_quantity) values (${sku}, ${sku}, ${'Compat ' + tag}, ${sku.toLowerCase()}, ${catId}, 10000, true, 'approved', 'in_stock', 5) returning id`;
    ids.push(p.id); return p.id as string;
  };
  const map = (from: string, to: string, verdict: string, enabled: boolean) =>
    raw`insert into product_compatibility_mappings (product_id, target_product_id, verdict, enabled) values (${from}, ${to}, ${verdict}, ${enabled})`;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    raw = require('../../apps/api/node_modules/postgres')(URL!, { max: 3, prepare: false });
    const [c] = await raw`select id from categories limit 1`;
    catId = c?.id ?? (await raw`insert into categories (name, slug) values ('Compat', ${'compat-' + Date.now()}) returning id`)[0].id;
    const { DrizzleProductRecommendationReader } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleProductRecommendationReader');
    reader = new DrizzleProductRecommendationReader();
  });
  afterAll(async () => {
    if (!raw) return;
    await raw`delete from product_compatibility_mappings where product_id = any(${ids}) or target_product_id = any(${ids})`;
    await raw`delete from products where id = any(${ids})`;
    await raw.end();
  });

  it('zero mappings → nothing (the production state)', async () => {
    const src = await mk('src0');
    expect(await reader.findCompatibilityTargetIds(src, 10)).toEqual([]);
  });

  it('one enabled, positive mapping → the target is emitted', async () => {
    const src = await mk('src1'); const tgt = await mk('tgt1');
    await map(src, tgt, 'compatible', true);
    expect(await reader.findCompatibilityTargetIds(src, 10)).toEqual([tgt]);
  });

  it('a DISABLED mapping is not a recommendation', async () => {
    const src = await mk('src2'); const tgt = await mk('tgt2');
    await map(src, tgt, 'compatible', false);
    expect(await reader.findCompatibilityTargetIds(src, 10)).toEqual([]);
  });

  it('an INCOMPATIBLE or UNKNOWN verdict is not a recommendation', async () => {
    const src = await mk('src3'); const a = await mk('tgt3a'); const b = await mk('tgt3b'); const c = await mk('tgt3c');
    await map(src, a, 'incompatible', true);
    await map(src, b, 'unknown', true);
    await map(src, c, 'exact', true);
    expect(await reader.findCompatibilityTargetIds(src, 10)).toEqual([c]);
  });
});
