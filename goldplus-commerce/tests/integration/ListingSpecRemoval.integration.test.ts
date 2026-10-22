import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/** removeValuesExcept (2026-10-22): only THIS product's values, only those not kept. Real PostgreSQL. */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('listing spec removal (real PostgreSQL)', () => {
  let raw: any;
  let repo: any;
  const tag = randomUUID().slice(0, 8);
  let cat = ''; let p1 = ''; let p2 = ''; let a1 = ''; let a2 = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    [{ id: cat }] = await raw`insert into categories (name, slug) values (${`Lsr ${tag}`}, ${`lsr-${tag}`}) returning id`;
    const prod = async (n: string) => (await raw`insert into products (sku, model_number, name, slug, category_id, price_ugx) values (${`LSR-${tag}-${n}`}, ${`LSR-${n}`}, ${`Lsr ${n}`}, ${`lsr-${tag}-${n}`}, ${cat}, 1000) returning id`)[0].id;
    p1 = await prod('1'); p2 = await prod('2');
    const attr = async (n: string) => (await raw`insert into attributes (category_id, name, slug) values (${cat}, ${n}, ${`${n}-${tag}`}) returning id`)[0].id;
    a1 = await attr('power'); a2 = await attr('port');
    for (const p of [p1, p2]) for (const a of [a1, a2]) await raw`insert into product_attribute_values (product_id, attribute_id, value) values (${p}, ${a}, 'v')`;
    const { DrizzleAttributeRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAttributeRepository');
    repo = new DrizzleAttributeRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from product_attribute_values where product_id in (${p1}, ${p2})`;
    await raw`delete from attributes where category_id = ${cat}`;
    await raw`delete from products where id in (${p1}, ${p2})`;
    await raw`delete from categories where id = ${cat}`;
    await raw.end({ timeout: 5 });
  });

  it('removes the dropped spec of this product only', async () => {
    expect(await repo.removeValuesExcept(p1, [a1])).toBe(1);
    const left = async (p: string) => (await raw`select attribute_id from product_attribute_values where product_id = ${p}`).map((r: any) => r.attribute_id).sort();
    expect(await left(p1)).toEqual([a1]);
    expect(await left(p2)).toEqual([a1, a2].sort());
  });

  it('an empty kept list clears this product, and nothing else', async () => {
    expect(await repo.removeValuesExcept(p1, [])).toBe(1);
    expect((await raw`select count(*)::int as n from product_attribute_values where product_id = ${p2}`)[0].n).toBe(2);
  });
});
