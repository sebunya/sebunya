import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

/** Gap analysis #6: the wishlists table (migration 0003) through plain SQL, on real PostgreSQL. */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const describeIf = URL ? describe : describe.skip;

describeIf('saved for later (real PostgreSQL)', () => {
  let raw: any; let repo: any;
  const tag = Date.now().toString(36);
  const ids = { user: '', category: '', live: '', draft: '' };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 2, prepare: false });
    ids.user = (await raw`insert into users (email, password_hash) values (${`saved-${tag}@example.com`}, 'x') returning id`)[0].id;
    ids.category = (await raw`insert into categories (name, slug) values ('SV', ${'sv-' + tag}) returning id`)[0].id;
    const mk = async (approval: string) => (await raw`insert into products (sku, model_number, name, slug, category_id, price_ugx, active, approval_status)
      values (${'SV-' + approval + tag}, ${'SV-' + tag}, 'Saved Test', ${'sv-' + approval + tag}, ${ids.category}, 10000, true, ${approval}) returning id`)[0].id;
    ids.live = await mk('approved');
    ids.draft = await mk('draft');
    const { DrizzleWishlistRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleWishlistRepository');
    repo = new DrizzleWishlistRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from wishlists where user_id = ${ids.user}`;
    await raw`delete from products where id = any(${[ids.live, ids.draft].filter(Boolean)})`;
    if (ids.category) await raw`delete from categories where id = ${ids.category}`;
    if (ids.user) await raw`delete from users where id = ${ids.user}`;
    await raw.end();
  });

  it('adds once, refuses a draft, lists newest first, removes', async () => {
    expect(await repo.add(ids.user, ids.live)).toBe('added');
    expect(await repo.add(ids.user, ids.live)).toBe('added');
    expect(await repo.add(ids.user, ids.draft)).toBe('unknown_product');
    expect(await repo.count(ids.user)).toBe(1);
    expect(await repo.list(ids.user, 10)).toEqual([ids.live]);
    expect(await repo.has(ids.user, ids.live)).toBe(true);
    await repo.remove(ids.user, ids.live);
    expect(await repo.has(ids.user, ids.live)).toBe(false);
  });
});
