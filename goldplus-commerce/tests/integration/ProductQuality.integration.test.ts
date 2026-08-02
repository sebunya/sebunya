import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Slice 5 — product data-quality scoring reads REAL product rows (including the
 * jsonb specifications count) from PostgreSQL and scores them. Proves the scan
 * maps every field correctly and that a rich product outscores a sparse one on
 * real data.
 *
 * Set COMMERCE_TEST_DATABASE_URL to a MIGRATED database. Skips otherwise.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('product data-quality scoring (real PostgreSQL)', () => {
  let useCase: any;
  let raw: any;
  const ids: { products: string[]; categories: string[] } = { products: [], categories: [] };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    const repoMod = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleProductQualityRepository');
    const ucMod = await import('../../apps/api/src/application/use-cases/products/ScoreProductQualityUseCase');
    useCase = new ucMod.ScoreProductQualityUseCase(new repoMod.DrizzleProductQualityRepository());

    const s = `qc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const [cat] = await raw`insert into categories (name, slug) values (${s}, ${s}) returning id`;
    ids.categories.push(cat.id);

    const [rich] = await raw`
      insert into products (sku, model_number, name, slug, category_id, category_name,
                            short_description, long_description, has_image, image_url,
                            price_ugx, has_retail_price, warranty_period, specifications)
      values (${s + '-rich'}, 'GP-200AH', 'GoldPlus 200Ah Deep-Cycle Solar Battery', ${s + '-rich'}, ${cat.id}, 'Batteries',
              'Sealed deep-cycle battery for solar backup, 200Ah capacity and long life.',
              ${'A maintenance-free sealed deep-cycle battery rated 200Ah for solar and inverter systems, with deep discharge tolerance and stable output for homes and light commercial sites.'},
              true, 'https://example/img.jpg', 1200000, true, '2 Years',
              ${raw.json({ capacity: '200Ah', voltage: '12V', chemistry: 'AGM', weight: '55kg' })})
      returning id`;
    ids.products.push(rich.id);

    const [sparse] = await raw`
      insert into products (sku, model_number, name, slug, category_id, price_ugx, has_retail_price)
      values (${s + '-sparse'}, ${''}, 'Item', ${s + '-sparse'}, ${cat.id}, 0, false)
      returning id`;
    ids.products.push(sparse.id);
  });

  afterAll(async () => {
    if (!raw) return;
    if (ids.products.length) await raw`delete from products where id = any(${ids.products})`;
    if (ids.categories.length) await raw`delete from categories where id = any(${ids.categories})`;
    await raw.end();
  });

  it('scores real products and surfaces the sparse one for attention', async () => {
    const report = await useCase.execute({ limit: 1000, attentionBelow: 70 });
    const byId = new Map(report.scores.map((s: any) => [s.productId, s]));
    const rich = byId.get(ids.products[0]);
    const sparse = byId.get(ids.products[1]);

    expect(rich.overall).toBeGreaterThanOrEqual(85);
    expect(rich.feedEligibility.eligible).toBe(true);
    expect(sparse.overall).toBeLessThan(30);
    expect(sparse.feedEligibility.eligible).toBe(false);
    // The sparse product is flagged; the rich one is not.
    const attentionIds = report.needsAttention.map((s: any) => s.productId);
    expect(attentionIds).toContain(ids.products[1]);
    expect(attentionIds).not.toContain(ids.products[0]);
  });

  it('reads the jsonb specifications count from real data', async () => {
    const report = await useCase.execute({ limit: 1000 });
    const rich = report.scores.find((s: any) => s.productId === ids.products[0]);
    // 4 spec keys => AEO structured-specs signal satisfied.
    expect(rich.aeoReadiness.missing).not.toContain('structured specifications (>=3)');
  });
});
