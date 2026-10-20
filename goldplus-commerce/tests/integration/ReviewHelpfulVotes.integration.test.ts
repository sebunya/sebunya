import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

/** Gap analysis #10: helpful votes on real PostgreSQL (upsert per voter, published only, ordering). */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const describeIf = URL ? describe : describe.skip;

describeIf('review helpful votes (real PostgreSQL)', () => {
  let raw: any; let repo: any;
  const tag = Date.now().toString(36);
  const ids = { product: '', category: '', reviews: [] as string[] };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    ids.category = (await raw`insert into categories (name, slug) values ('RV', ${'rv-' + tag}) returning id`)[0].id;
    ids.product = (await raw`insert into products (sku, model_number, name, slug, category_id, price_ugx, active, approval_status)
      values (${'RV-' + tag}, ${'RV-' + tag}, 'Vote Test', ${'rv-' + tag}, ${ids.category}, 10000, true, 'approved') returning id`)[0].id;
    for (const [status, ageMin] of [['published', 30], ['published', 10], ['pending', 5]] as const) {
      ids.reviews.push((await raw`insert into reviews (product_id, customer_identity_hash, rating, status, is_verified_purchase, created_at)
        values (${ids.product}, ${'h-' + Math.random()}, 5, ${status}, true, ${new Date(Date.now() - ageMin * 60_000)}) returning id`)[0].id);
    }
    const { DrizzleReviewRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleReviewRepository');
    repo = new DrizzleReviewRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from review_votes where review_id = any(${ids.reviews})`;
    await raw`delete from reviews where id = any(${ids.reviews})`;
    if (ids.product) await raw`delete from products where id = ${ids.product}`;
    if (ids.category) await raw`delete from categories where id = ${ids.category}`;
    await raw.end();
  });

  it('one vote per voter, a second vote replaces it, pending reviews refuse, most helpful first', async () => {
    const [older, newer, pending] = ids.reviews;
    expect(await repo.recordVote({ reviewId: older, voterIdentityHash: 'v1', vote: 'helpful' })).toBe('recorded');
    expect(await repo.recordVote({ reviewId: older, voterIdentityHash: 'v1', vote: 'helpful' })).toBe('recorded');
    expect(await repo.recordVote({ reviewId: older, voterIdentityHash: 'v2', vote: 'helpful' })).toBe('recorded');
    expect(await repo.recordVote({ reviewId: newer, voterIdentityHash: 'v3', vote: 'not_helpful' })).toBe('recorded');
    expect(await repo.recordVote({ reviewId: pending, voterIdentityHash: 'v1', vote: 'helpful' })).toBe('not_found');
    const list = await repo.listPublished(ids.product, 10);
    expect(list.map((r: any) => [r.id, r.helpfulCount])).toEqual([[older, 2], [newer, 0]]);
    await repo.recordVote({ reviewId: older, voterIdentityHash: 'v2', vote: 'not_helpful' });
    expect((await repo.listPublished(ids.product, 10))[0].helpfulCount).toBe(1);
  });
});
