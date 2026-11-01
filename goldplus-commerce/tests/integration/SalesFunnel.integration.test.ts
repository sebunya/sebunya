import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

/** Gap analysis #3: the funnel's aggregates on real PostgreSQL, counted in a window only this test writes to. */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const describeIf = URL ? describe : describe.skip;

describeIf('sales funnel (real PostgreSQL)', () => {
  let raw: any;
  let reader: any;
  const tag = Date.now().toString(36).slice(-6).toUpperCase();
  // A window in 2001, which no other suite writes to.
  const start = new Date('2001-03-01T00:00:00Z');
  const end = new Date('2001-03-02T00:00:00Z');
  const at = new Date('2001-03-01T12:00:00Z');
  const ids = { orders: [] as string[], carts: [] as string[], events: [] as string[], aband: [] as string[], product: '', category: '' };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    ids.category = (await raw`insert into categories (name, slug) values ('F', ${'f-' + tag}) returning id`)[0].id;
    ids.product = (await raw`insert into products (sku, model_number, name, slug, category_id, price_ugx, active, approval_status)
      values (${'FN-' + tag}, ${'FN-' + tag}, 'Funnel Test', ${'fn-' + tag.toLowerCase()}, ${ids.category}, 10000, true, 'approved') returning id`)[0].id;
    // Three shoppers view; one views twice and once as an engine row (not counted).
    for (const [anon, producer] of [['a1', null], ['a1', null], ['a2', null], ['a3', null], ['a4', 'api-engine']] as const) {
      ids.events.push((await raw`insert into recommendation_events (event_type, anonymous_id, product_id, producer, created_at)
        values ('PRODUCT_VIEWED', ${anon + tag}, ${ids.product}, ${producer}, ${at}) returning id`)[0].id);
    }
    // Two carts with items, one empty cart.
    for (const withItem of [true, true, false]) {
      const c = (await raw`insert into carts (owner_kind, owner_id, updated_at) values ('GUEST', ${'f-' + Math.random()}, ${at}) returning id`)[0].id;
      ids.carts.push(c);
      if (withItem) await raw`insert into cart_items (cart_id, product_id, quantity) values (${c}, ${ids.product}, 1)`;
    }
    ids.aband.push((await raw`insert into cart_abandonments (cart_id, item_count, subtotal_ugx, classified_at, last_activity_at)
      values (${ids.carts[0]}, 1, 10000, ${at}, ${at}) returning id`)[0].id);
    // Orders: one paid, one unpaid open, one cancelled unpaid.
    let n = 0;
    for (const [status, payment, total] of [['processing', 'paid', 30000], ['pending_payment', 'unpaid', 20000], ['cancelled', 'unpaid', 5000]] as const) {
      n += 1;
      ids.orders.push((await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, status, payment_status,
          payment_method, subtotal_amount, delivery_fee, total_amount, created_at)
        values (${`GP-FN${tag}${n}`}, 'F', ${'+2567000' + n + tag.slice(-3)}, 'Kampala', 'Plot', ${status}, ${payment}, 'pesapal', ${total}, 0, ${total}, ${at}) returning id`)[0].id);
    }
    const { DrizzleSalesFunnelReader } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleSalesFunnelReader');
    reader = new DrizzleSalesFunnelReader();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from cart_abandonments where id = any(${ids.aband})`;
    await raw`delete from cart_items where cart_id = any(${ids.carts})`;
    await raw`delete from carts where id = any(${ids.carts})`;
    await raw`delete from recommendation_events where id = any(${ids.events})`;
    await raw`delete from orders where id = any(${ids.orders})`;
    if (ids.product) await raw`delete from products where id = ${ids.product}`;
    if (ids.category) await raw`delete from categories where id = ${ids.category}`;
    await raw.end();
  });

  it('counts each step from its own source, in the window only', async () => {
    expect(await reader.counts(start, end)).toEqual({
      productViewers: 3,
      cartsWithItems: 2,
      ordersPlaced: 3,
      ordersPlacedValueUgx: 55000,
      ordersPaid: 1,
      ordersPaidValueUgx: 30000,
      unpaidOpenValueUgx: 20000,
      abandonedCarts: 1,
      abandonedCartValueUgx: 10000,
    });
    const empty = await reader.counts(new Date('2001-04-01T00:00:00Z'), new Date('2001-04-02T00:00:00Z'));
    expect(empty.productViewers + empty.ordersPlaced + empty.cartsWithItems).toBe(0);
  });
});
