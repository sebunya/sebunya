import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

/**
 * products.is_feed_eligible defaulted to false and nothing ever set it, so the
 * Google Merchant feed had been empty for every product since launch
 * (found 2026-09-01: 184 live products, 0 feed items). Listing is opt-OUT:
 * the flag has a default of true, a migration that backfills it, an admin
 * control that owns it, and an API path that reads and writes it.
 */
describe('the merchant feed is opt-out', () => {
  it('the column defaults to true and the migration backfills idempotently', () => {
    expect(read('apps/api/src/infrastructure/db/schema/products.ts')).toContain("isFeedEligible: boolean('is_feed_eligible').default(true).notNull()");
    const sql = read('apps/api/src/infrastructure/db/migrations/0128_feed_opt_out.sql');
    expect(sql).toContain('alter table products alter column is_feed_eligible set default true;');
    expect(sql).toContain('update products set is_feed_eligible = true where is_feed_eligible = false;');
  });

  it('every hand-applied migration is journaled so the migrator is the single source of truth', () => {
    const journal = JSON.parse(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json')) as { entries: Array<{ idx: number; tag: string; when: number }> };
    const tags = journal.entries.map((e) => e.tag);
    for (const t of ['0126_blog', '0127_product_price_floor', '0128_feed_opt_out']) expect(tags).toContain(t);
    const whens = journal.entries.map((e) => e.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
    expect(new Set(journal.entries.map((e) => e.idx)).size).toBe(journal.entries.length);
  });

  it('the admin owns the flag: the API exposes and accepts it, the edit page shows it', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/products.ts');
    expect(route).toContain('feedEligibilityFor(productId)');
    expect(route).toContain("if (typeof body.isFeedEligible === 'boolean') await registry.productRepo.setFeedEligibility(productId, body.isFeedEligible);");
    const page = read('apps/web/src/pages/admin/products/[id]/edit-properties.astro');
    expect(page).toContain('name="isFeedEligible"');
    expect(page).toContain('checked={product.isFeedEligible !== false}');
    expect(page).toMatch(/approvalStatus, isFeedEligible\s*\}\)/);
  });
});
