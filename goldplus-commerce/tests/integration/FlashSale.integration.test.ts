import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleFlashSaleRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzleFlashSaleRepository';

/**
 * U5 — flash-sale allocation on real PostgreSQL.
 *   AC2 100 units, 1000 concurrent reservations → exactly 100 successes.
 *   AC4 a customer at their per-customer limit cannot reserve via a second session.
 *   AC5 cancelling restores unsold allocation to general stock + reverts atomically.
 *   AC6 reservations expire after the TTL and return units to the pool.
 * AC1 (500-RPS load test) and AC3 (edge cache) require configured infra evidence.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('flash sale allocation (real PostgreSQL, U5)', () => {
  let raw: any;
  const repo = new DrizzleFlashSaleRepository();
  let categoryId: string;
  const productIds: string[] = [];
  const saleIds: string[] = [];
  const itemIds: string[] = [];

  const mkProduct = async (stock: number): Promise<string> => {
    const s = `fs-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 40);
    const [p] = await raw`insert into products (sku, model_number, name, slug, category_id, stock_quantity) values (${s}, ${s}, ${s}, ${s}, ${categoryId}, ${stock}) returning id`;
    productIds.push(p.id);
    return p.id;
  };
  const mkSaleItem = async (productId: string, allocated: number, sold = 0): Promise<string> => {
    const [sale] = await raw`insert into flash_sales (name, starts_at, ends_at, status) values ('S', now(), now() + interval '1 hour', 'live') returning id`;
    saleIds.push(sale.id);
    const [item] = await raw`insert into flash_sale_items (flash_sale_id, product_id, flash_price_ugx, original_price_ugx, units_allocated, units_sold) values (${sale.id}, ${productId}, 5000, 10000, ${allocated}, ${sold}) returning id`;
    itemIds.push(item.id);
    return item.id;
  };
  const itemCounts = async (itemId: string) => (await raw`select units_reserved, units_sold, units_allocated from flash_sale_items where id = ${itemId}`)[0];

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 8, prepare: false });
    const s = `fscat-${Date.now()}`;
    const [cat] = await raw`insert into categories (name, slug) values (${s}, ${s}) returning id`;
    categoryId = cat.id;
  });

  afterAll(async () => {
    if (!raw) return;
    if (itemIds.length) await raw`delete from flash_sale_reservations where flash_sale_item_id = any(${itemIds})`;
    if (itemIds.length) await raw`delete from flash_sale_items where id = any(${itemIds})`;
    if (saleIds.length) await raw`delete from flash_sales where id = any(${saleIds})`;
    if (productIds.length) await raw`delete from products where id = any(${productIds})`;
    await raw`delete from categories where id = ${categoryId}`;
    await raw.end();
  });

  it('AC2: 100 units under 1000 concurrent reservations yield exactly 100 successes', async () => {
    const product = await mkProduct(0);
    const item = await mkSaleItem(product, 100);
    const attempts = Array.from({ length: 1000 }, (_, i) => i);
    const results = await Promise.all(
      attempts.map((i) =>
        repo.reserve({ flashSaleItemId: item, customerIdentityHash: `cust-${i}`, idempotencyKey: `idem-${i}`, reservationToken: randomUUID(), ttlSeconds: 900, now: new Date() }),
      ),
    );
    const ok = results.filter((r) => r.ok).length;
    const soldOut = results.filter((r) => !r.ok && r.reason === 'SOLD_OUT').length;
    expect(ok).toBe(100); // EXACTLY the allocation
    expect(soldOut).toBe(900);
    const counts = await itemCounts(item);
    expect(counts.units_reserved).toBe(100);
  }, 60_000);

  it('AC4: a customer at their per-customer limit cannot reserve via a second concurrent session', async () => {
    const product = await mkProduct(0);
    const item = await mkSaleItem(product, 100); // plenty of allocation
    const attempts = Array.from({ length: 3 }, (_, i) => i);
    const results = await Promise.all(
      attempts.map((i) =>
        repo.reserve({ flashSaleItemId: item, customerIdentityHash: 'same-customer', idempotencyKey: `pcl-${i}`, reservationToken: randomUUID(), perCustomerLimit: 2, ttlSeconds: 900, now: new Date() }),
      ),
    );
    expect(results.filter((r) => r.ok).length).toBe(2); // limit is 2, even across sessions
    expect(results.filter((r) => !r.ok && r.reason === 'PER_CUSTOMER_LIMIT').length).toBe(1);
  }, 30_000);

  it('AC6: reservations expire after the TTL and return units to the pool', async () => {
    const product = await mkProduct(0);
    const item = await mkSaleItem(product, 5);
    await repo.reserve({ flashSaleItemId: item, customerIdentityHash: 'c', idempotencyKey: 'exp-1', reservationToken: randomUUID(), ttlSeconds: 0, now: new Date(Date.now() - 1000) });
    expect((await itemCounts(item)).units_reserved).toBe(1);
    const res = await repo.expireReservations(new Date());
    expect(res.expired).toBe(1);
    expect((await itemCounts(item)).units_reserved).toBe(0); // unit returned to the pool
  });

  it('AC5: cancelling restores unsold allocation to general stock and reverts atomically', async () => {
    const product = await mkProduct(10); // general stock 10
    const item = await mkSaleItem(product, 100, 30); // allocated 100, sold 30 → 70 unsold
    await repo.reserve({ flashSaleItemId: item, customerIdentityHash: 'c', idempotencyKey: 'cancel-r', reservationToken: randomUUID(), ttlSeconds: 900, now: new Date() });

    const result = await repo.cancelSale(saleIds[saleIds.length - 1], new Date());
    expect(result.cancelled).toBe(true);
    expect(result.restoredUnits).toBe(70); // unsold allocation
    expect((await raw`select stock_quantity from products where id = ${product}`)[0].stock_quantity).toBe(80); // 10 + 70
    expect((await raw`select status from flash_sales where id = ${saleIds[saleIds.length - 1]}`)[0].status).toBe('cancelled');
    expect((await raw`select status from flash_sale_reservations where flash_sale_item_id = ${item}`)[0].status).toBe('released');

    const again = await repo.cancelSale(saleIds[saleIds.length - 1], new Date()); // idempotent
    expect(again.cancelled).toBe(false);
  });
});
