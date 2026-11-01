import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/** "Popular in <area>" against real PostgreSQL: paid orders by area, distinct buyers (account or phone), threshold. */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('nearby demand reader (real PostgreSQL)', () => {
  let raw: any;
  const tag = randomUUID().slice(0, 8);
  const slug = `test-near-${tag}`;
  let productA: string;
  let productB: string;
  const orderIds: string[] = [];
  let categoryId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    const [{ id: cat }] = await raw`insert into categories (name, slug) values (${`near-${tag}`}, ${`near-${tag}`}) returning id`;
    categoryId = cat;
    const mk = async (k: string) =>
      (await raw`insert into products (sku, model_number, name, slug, category_id, stock_quantity, reserved_quantity)
        values (${`NY-${tag}-${k}`}, ${`NY-${tag}-${k}`}, ${`Near ${k}`}, ${`near-${tag}-${k}`}, ${cat}, 5, 0) returning id`)[0].id;
    productA = await mk('a');
    productB = await mk('b');
    const order = async (n: number, phone: string, items: string[], paid: boolean) => {
      const [{ id }] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, delivery_location, subtotal_amount, total_amount, status, payment_status)
        values (${`NY${tag}${n}`}, 'Near Tester', ${phone}, 'Near, Wakiso', 'x', ${raw.json({ areaSlug: slug, district: 'Wakiso' })}, 1000, 1000, 'processing', ${paid ? 'paid' : 'unpaid'}) returning id`;
      orderIds.push(id);
      for (const p of items) await raw`insert into order_items (order_id, product_id, sku, product_name, quantity, unit_price) values (${id}, ${p}, 'TEST', 'x', 1, 1000)`;
    };
    await order(1, `0701${tag.replace(/\D/g, '1').padEnd(6, '1').slice(0, 6)}`, [productA, productB], true);
    await order(2, `+256702${tag.replace(/\D/g, '2').padEnd(6, '2').slice(0, 6)}`, [productA], true);
    await order(3, `+256701${tag.replace(/\D/g, '1').padEnd(6, '1').slice(0, 6)}`, [productB], true); // same buyer, another spelling
    await order(4, `0703${tag.replace(/\D/g, '3').padEnd(6, '3').slice(0, 6)}`, [productB], false); // unpaid
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from order_items where order_id in ${raw(orderIds)}`;
    await raw`delete from orders where id in ${raw(orderIds)}`;
    await raw`delete from products where id in (${productA}, ${productB})`;
    await raw`delete from categories where id = ${categoryId}`;
    await raw.end({ timeout: 5 });
  });

  it('counts distinct paying buyers per product in the area and applies the threshold', async () => {
    const { DrizzleNearbyDemandReader } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleNearbyDemandReader');
    const r = await new DrizzleNearbyDemandReader().topProducts({ kind: 'area', areaSlug: slug }, { sinceDays: 30, minBuyers: 2, limit: 10 });
    expect(r).toEqual([{ productId: productA, buyers: 2 }]);
    const d = await new DrizzleNearbyDemandReader().topProducts({ kind: 'districts', districts: ['wakiso'] }, { sinceDays: 30, minBuyers: 1, limit: 500 });
    expect(d.find((x) => x.productId === productB)?.buyers).toBeGreaterThanOrEqual(1);
  });
});
