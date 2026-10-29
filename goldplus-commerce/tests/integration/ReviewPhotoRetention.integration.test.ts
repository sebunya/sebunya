import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Review photo retention on real PostgreSQL (0209, 2026-10-29 review). Nothing deletes reviews, so the ON DELETE
 * CASCADE never ran and a rejected review's photos were kept for ever. The sweep now deletes them once the rejection
 * has stood for 30 days; a published review's photos, and a recent rejection's, stay.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const describeIf = URL ? describe : describe.skip;

describeIf('review photo retention (real PostgreSQL)', () => {
  let raw: any; let repo: any;
  let categoryId = ''; let productId = '';
  const reviewIds: string[] = [];
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const DAY = 86_400_000;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    categoryId = (await raw`insert into categories (name, slug) values ('T', ${`rp-${tag}`}) returning id`)[0].id;
    const sku = `RP-${tag}`.slice(0, 20);
    productId = (await raw`insert into products (sku, model_number, name, slug, category_id, price_ugx, active, approval_status)
      values (${sku}, ${sku}, 'Photo Test', ${sku.toLowerCase()}, ${categoryId}, 10000, true, 'approved') returning id`)[0].id;
    const { DrizzleReviewPhotoRepository } = await import('../../apps/api/src/infrastructure/reviews/DrizzleReviewPhotoRepository');
    repo = new DrizzleReviewPhotoRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    if (reviewIds.length) { await raw`delete from review_photos where review_id = any(${reviewIds})`; await raw`delete from reviews where id = any(${reviewIds})`; }
    if (productId) await raw`delete from products where id = ${productId}`;
    if (categoryId) await raw`delete from categories where id = ${categoryId}`;
    await raw.end();
  });

  const reviewWithPhoto = async (status: string, moderatedDaysAgo: number | null) => {
    const [r] = await raw`insert into reviews (product_id, customer_identity_hash, rating, status, moderated_at)
      values (${productId}, ${`${tag}${reviewIds.length}`.padEnd(64, 'r')}, 5, ${status}, ${moderatedDaysAgo === null ? null : new Date(Date.now() - moderatedDaysAgo * DAY)}) returning id`;
    reviewIds.push(r.id);
    const [p] = await raw`insert into review_photos (image, width, height, review_id, attached_at)
      values (${Buffer.alloc(2048, 7)}, 600, 600, ${r.id}, now()) returning id`;
    return p.id as string;
  };

  it('deletes the photos of a review rejected more than 30 days ago, and nothing else', async () => {
    const oldRejection = await reviewWithPhoto('rejected', 40);
    const recentRejection = await reviewWithPhoto('rejected', 3);
    const published = await reviewWithPhoto('published', 40);
    const removed = await repo.deleteOfRejectedBefore(new Date(Date.now() - 30 * DAY));
    expect(removed).toBeGreaterThanOrEqual(1);
    const left = (await raw`select id from review_photos where id in (${oldRejection}, ${recentRejection}, ${published})`).map((x: any) => x.id).sort();
    expect(left).toEqual([recentRejection, published].sort());
  });
});
