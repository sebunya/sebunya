import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

/** Gap analysis #8: the delivery date a change-of-mind return is measured from, on real PostgreSQL. */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const describeIf = URL ? describe : describe.skip;

describeIf('order delivered-at (real PostgreSQL)', () => {
  let raw: any; let reader: any;
  const tag = Date.now().toString(36).toUpperCase();
  let orderId = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 2, prepare: false });
    orderId = (await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, status, payment_status, subtotal_amount, delivery_fee, total_amount)
      values (${'GP-DA' + tag}, 'D', '+256700009999', 'Kampala', 'Plot', 'delivered', 'paid', 1000, 0, 1000) returning id`)[0].id;
    const { DrizzleOrderDeliveredAt } = await import('../../apps/api/src/infrastructure/commerce/DrizzleOrderDeliveredAt');
    reader = new DrizzleOrderDeliveredAt();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from order_events where order_id = ${orderId}`;
    await raw`delete from orders where id = ${orderId}`;
    await raw.end();
  });

  it('is the latest real move to delivered or completed, and ignores synthetic rows', async () => {
    expect(await reader.deliveredAt('GP-DA' + tag)).toBeNull();
    const ins = async (to: string, at: string, synthetic: boolean) => {
      await raw`insert into order_events (order_id, from_status, to_status, actor_type, source, is_synthetic, occurred_at)
                values (${orderId}, 'dispatched', ${to}, 'system', 'system', ${synthetic}, ${at})`;
    };
    await ins('delivered', '2026-10-01T10:00:00Z', false);
    await ins('completed', '2026-10-05T10:00:00Z', true);
    expect((await reader.deliveredAt('GP-DA' + tag))?.toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });
});
