import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

/** Gap analysis #16: the dealer portal reads one phone's records, in any stored phone shape, on real PostgreSQL. */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const describeIf = URL ? describe : describe.skip;

describeIf('dealer portal reader (real PostgreSQL)', () => {
  let raw: any; let reader: any;
  const tag = Date.now().toString(36).toUpperCase();
  const nine = String(700000000 + (Date.now() % 99_999_999)).slice(-9);
  const ids = { orders: [] as string[], quotes: [] as string[], apps: [] as string[] };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 2, prepare: false });
    const order = async (num: string, phone: string, status: string, pay: string, total: number, at: string) =>
      ids.orders.push((await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, status, payment_status, subtotal_amount, delivery_fee, total_amount, created_at)
        values (${num}, 'D', ${phone}, 'Kampala', 'Plot', ${status}, ${pay}, ${total}, 0, ${total}, ${at}) returning id`)[0].id);
    // Three shapes of the same phone, and one other phone.
    await order(`GP-DP${tag}1`, `0${nine}`, 'delivered', 'paid', 300000, '2026-09-10T09:00:00Z');
    await order(`GP-DP${tag}2`, `+256${nine}`, 'received', 'unpaid', 120000, '2026-10-05T09:00:00Z');
    await order(`GP-DP${tag}3`, `256${nine}`, 'cancelled', 'unpaid', 50000, '2026-10-06T09:00:00Z');
    await order(`GP-DP${tag}4`, '+256799999999', 'delivered', 'paid', 999999, '2026-10-06T09:00:00Z');
    ids.apps.push((await raw`insert into dealer_applications (business_name, contact_name, email, phone, tin_number, location, status)
      values ('Test Electronics', 'D', 'd@example.com', ${'0' + nine}, '', 'Kampala', 'approved') returning id`)[0].id);
    const { DrizzleDealerPortalReader } = await import('../../apps/api/src/infrastructure/dealers/DrizzleDealerPortalReader');
    reader = new DrizzleDealerPortalReader();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from orders where id = any(${ids.orders})`;
    await raw`delete from dealer_applications where id = any(${ids.apps})`;
    await raw.end();
  });

  it('finds the phone in every stored shape, never another phone, and totals the months', async () => {
    const a = await reader.account(`+256${nine}`);
    expect(a.application).toMatchObject({ businessName: 'Test Electronics', status: 'approved' });
    expect(a.orders.map((o: any) => o.orderNumber).sort()).toEqual([`GP-DP${tag}1`, `GP-DP${tag}2`, `GP-DP${tag}3`]);
    expect(a.statement).toEqual([
      { month: '2026-10', orders: 2, totalUgx: 170000, paidUgx: 0, unpaidOpenUgx: 120000 },
      { month: '2026-09', orders: 1, totalUgx: 300000, paidUgx: 300000, unpaidOpenUgx: 0 },
    ]);
    expect(a.quotes).toEqual([]);
  });
});
