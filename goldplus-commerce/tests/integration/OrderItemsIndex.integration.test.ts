import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * P0-2 AC9 — the order-detail query uses the index on order_items.order_id
 * (migration 0066), not a sequential scan. Verified on real PostgreSQL with
 * seeded rows and enable_seqscan=off for a deterministic plan.
 *
 * Set COMMERCE_TEST_DATABASE_URL to a MIGRATED database. Skips otherwise.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('order_items.order_id index (real PostgreSQL, P0-2 AC9)', () => {
  let raw: any;
  const ids: { orders: string[]; products: string[]; categories: string[] } = { orders: [], products: [], categories: [] };
  let orderId: string;

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 2, prepare: false });
    const s = `oi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [cat] = await raw`insert into categories (name, slug) values (${s}, ${s}) returning id`;
    ids.categories.push(cat.id);
    const [prod] = await raw`insert into products (sku, model_number, name, slug, category_id) values (${s}, ${s}, ${s}, ${s}, ${cat.id}) returning id`;
    ids.products.push(prod.id);
    const on = `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`.slice(0, 20);
    const [order] = await raw`
      insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status)
      values (${on}, 'T', '070', 'Kla', 'Adr', 100, 0, 100, 'received', 'unpaid') returning id`;
    orderId = order.id;
    ids.orders.push(order.id);
    // Seed enough order_items across several orders so an index scan is the sane plan.
    for (let i = 0; i < 50; i++) {
      const oon = `x${Date.now().toString(36)}${i}`.slice(0, 20);
      const [o] = await raw`
        insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status)
        values (${oon}, 'T', '070', 'Kla', 'Adr', 100, 0, 100, 'received', 'unpaid') returning id`;
      ids.orders.push(o.id);
      await raw`insert into order_items (order_id, product_id, sku, product_name, quantity, unit_price) values (${o.id}, ${prod.id}, 'SKU', 'Item', 1, 100)`;
    }
    await raw`insert into order_items (order_id, product_id, sku, product_name, quantity, unit_price) values (${orderId}, ${prod.id}, 'SKU', 'Item', 2, 100)`;
    await raw`analyze order_items`;
  });

  afterAll(async () => {
    if (!raw) return;
    if (ids.orders.length) {
      await raw`delete from order_items where order_id = any(${ids.orders})`;
      await raw`delete from orders where id = any(${ids.orders})`;
    }
    if (ids.products.length) await raw`delete from products where id = any(${ids.products})`;
    if (ids.categories.length) await raw`delete from categories where id = any(${ids.categories})`;
    await raw.end();
  });

  it('EXPLAIN of the order-detail query uses order_items_order_id_idx', async () => {
    await raw.unsafe('set enable_seqscan = off');
    const rows = await raw.unsafe(`explain select * from order_items where order_id = '${orderId}'`);
    const plan = rows.map((r: any) => r['QUERY PLAN']).join('\n');
    expect(plan).toMatch(/Index Scan.*order_items_order_id_idx|order_items_order_id_idx/);
    expect(plan).not.toMatch(/Seq Scan on order_items/);
  });
});
