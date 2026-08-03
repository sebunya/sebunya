import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleSeoRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzleSeoRepository';

/**
 * U6 — SEO on real PostgreSQL.
 *   AC1 the product sitemap contains every approved active product, not 60.
 *   AC2 lastmod reflects actual entity modification time (updated_at).
 *   AC6 a slug change creates a 301 and the old URL resolves.
 *   AC7 GSC data lands in the warehouse; clicks-by-product for the last 28 days.
 * AC3 (Rich Results), AC8 (Lighthouse) require external tools (not fabricated).
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('SEO redirects / sitemap / GSC (real PostgreSQL, U6)', () => {
  let raw: any;
  const repo = new DrizzleSeoRepository();
  let categoryId: string;
  const productIds: string[] = [];
  const tag = `seo${Date.now().toString(36)}`;

  const mkProduct = async (opts: { active?: boolean; approval?: string } = {}): Promise<{ id: string; slug: string }> => {
    const s = `${tag}-${productIds.length}-${Math.random().toString(36).slice(2, 5)}`.slice(0, 40);
    const [p] = await raw`insert into products (sku, model_number, name, slug, category_id, active, approval_status) values (${s}, ${s}, ${s}, ${s}, ${categoryId}, ${opts.active ?? true}, ${opts.approval ?? 'approved'}) returning id, slug`;
    productIds.push(p.id);
    return { id: p.id, slug: p.slug };
  };

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 6, prepare: false });
    const s = `seocat-${Date.now()}`;
    const [cat] = await raw`insert into categories (name, slug) values (${s}, ${s}) returning id`;
    categoryId = cat.id;
  });

  afterAll(async () => {
    if (!raw) return;
    if (productIds.length) {
      await raw`delete from gsc_performance where product_id = any(${productIds})`;
      await raw`delete from redirects where reason = 'product_slug_change' and to_path like ${'%' + tag + '%'}`;
      await raw`delete from products where id = any(${productIds})`;
    }
    await raw`delete from categories where id = ${categoryId}`;
    await raw.end();
  });

  it('AC1: the sitemap includes every approved active product (not capped at 60) and excludes inactive/unapproved', async () => {
    for (let i = 0; i < 65; i++) await mkProduct();
    await mkProduct({ active: false });
    await mkProduct({ approval: 'draft' });

    // Enumerate the whole sitemap in pages.
    const all: string[] = [];
    for (let offset = 0; ; offset += 25) {
      const page = await repo.sitemapProducts(offset, 25);
      if (page.length === 0) break;
      all.push(...page.map((p) => p.slug));
      if (page.length < 25) break;
    }
    const mine = all.filter((s) => s.startsWith(tag));
    expect(mine.length).toBe(65); // all approved-active; NOT 60, and not the 2 excluded
  }, 30_000);

  it('AC2: sitemap lastmod is the product updated_at, not now()', async () => {
    const p = await mkProduct();
    await raw`update products set updated_at = '2026-01-15T00:00:00Z' where id = ${p.id}`;
    const page = await repo.sitemapProducts(0, 50_000);
    const row = page.find((r) => r.slug === p.slug);
    expect(row).toBeDefined();
    expect(new Date(row!.updatedAt).toISOString().slice(0, 10)).toBe('2026-01-15');
  });

  it('AC6: a product slug change creates a 301 and the old URL resolves', async () => {
    const created = await repo.recordSlugChange({ oldSlug: `${tag}-old`, newSlug: `${tag}-new`, createdBy: null, now: new Date() });
    expect(created.fromPath).toBe(`/p/${tag}-old`);
    const resolved = await repo.resolveRedirect(`/p/${tag}-old`, new Date());
    expect(resolved).toEqual({ toPath: `/p/${tag}-new`, statusCode: 301 });
    // Hit count recorded.
    expect((await raw`select hit_count from redirects where from_path = ${`/p/${tag}-old`}`)[0].hit_count).toBe(1);
    expect(await repo.resolveRedirect('/p/does-not-exist', new Date())).toBeNull();
  });

  it('AC7: GSC data lands and clicks-by-product for the last 28 days is correct', async () => {
    const p = await mkProduct();
    const today = new Date('2026-08-03');
    const within = '2026-07-20'; // within 28d
    const old = '2026-06-01'; // outside 28d
    await raw`insert into gsc_performance (date, page, query, product_id, clicks, impressions) values (${within}, ${'/p/x'}, 'charger', ${p.id}, 12, 100)`;
    await raw`insert into gsc_performance (date, page, query, product_id, clicks, impressions) values (${within}, ${'/p/x'}, 'usb-c', ${p.id}, 8, 90)`;
    await raw`insert into gsc_performance (date, page, query, product_id, clicks, impressions) values (${old}, ${'/p/x'}, 'old', ${p.id}, 999, 100)`;

    const rows = await repo.clicksByProductLast28Days(today);
    const mine = rows.find((r) => r.productId === p.id);
    expect(mine?.clicks).toBe(20); // 12 + 8 within window; the 999 old row excluded
  });
});
