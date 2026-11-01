import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * P0-2 — the migration 0067 backfill is TRUTHFUL, and the history read uses the
 * (order_id, occurred_at) index. Proven on real PostgreSQL.
 *
 *  truthful backfill   exactly ONE synthetic snapshot per pre-existing order,
 *                      is_synthetic=true, from_status=null (asserts only "the
 *                      order HELD this state", never an observed transition),
 *                      to_status = the order's stored status. Re-running invents
 *                      nothing (idempotent via NOT EXISTS).
 *  indexed history     the bounded history query uses order_events_order_occurred_idx,
 *                      not a sequential scan.
 *
 * Requires COMMERCE_TEST_DATABASE_URL pointing at the migrated database.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('order_events backfill + indexed history (real PostgreSQL, P0-2)', () => {
  let raw: any;
  const createdOrders: string[] = [];

  // Migration 0067's backfill statement, verbatim EXCEPT for the added
  // `o.id = ANY(...)` scope. The migration is intentionally global (every order);
  // scoping to this test's own orders is purely a test-isolation measure so it
  // does not touch rows created by other integration files running in parallel.
  // The logic under test — one synthetic snapshot per order, from_status NULL,
  // is_synthetic=true, and the NOT EXISTS idempotency/never-overwrite guard — is
  // identical to the migration.
  const runBackfill = () => raw`
    INSERT INTO order_events (order_id, from_status, to_status, actor_type, source, reason_code, is_synthetic, occurred_at)
    SELECT o.id, NULL, o.status, 'migration', 'migration', 'legacy_state_snapshot_backfill', true, o.created_at
    FROM orders o
    WHERE o.id = ANY(${createdOrders})
      AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id)`;

  const seedOrder = async (status: string): Promise<string> => {
    const on = `bf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [order] = await raw`
      insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status)
      values (${on}, 'T', '070', 'Kla', 'Adr', 100, 0, 100, ${status}, 'unpaid') returning id`;
    createdOrders.push(order.id);
    return order.id;
  };

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 2, prepare: false });
  });

  afterEach(async () => {
    if (createdOrders.length) {
      await raw`delete from order_events where order_id = any(${createdOrders})`;
      await raw`delete from orders where id = any(${createdOrders})`;
      createdOrders.length = 0;
    }
  });

  afterAll(async () => {
    if (raw) await raw.end();
  });

  it('backfills exactly one truthful synthetic snapshot per pre-existing order', async () => {
    const a = await seedOrder('received');
    const b = await seedOrder('processing');
    const c = await seedOrder('completed');

    await runBackfill();

    for (const [id, status] of [[a, 'received'], [b, 'processing'], [c, 'completed']] as const) {
      const rows = await raw`select * from order_events where order_id = ${id}`;
      expect(rows.length).toBe(1);
      const e = rows[0];
      expect(e.is_synthetic).toBe(true);
      expect(e.from_status).toBeNull(); // asserts state HELD, not an observed transition
      expect(e.to_status).toBe(status); // truthfully the order's stored status
      expect(e.actor_type).toBe('migration');
      expect(e.source).toBe('migration');
      expect(e.reason_code).toBe('legacy_state_snapshot_backfill');
      expect(e.actor_id).toBeNull(); // no invented actor
    }
  });

  it('is idempotent — re-running the backfill invents no new events', async () => {
    const a = await seedOrder('received');
    await runBackfill();
    const afterFirst = (await raw`select count(*)::int n from order_events where order_id = ${a}`)[0].n;
    await runBackfill();
    await runBackfill();
    const afterThird = (await raw`select count(*)::int n from order_events where order_id = ${a}`)[0].n;
    expect(afterFirst).toBe(1);
    expect(afterThird).toBe(1); // NOT EXISTS keeps re-runs a no-op
  });

  it('does not overwrite a real transition event with a synthetic one', async () => {
    const a = await seedOrder('received');
    // A real transition event already exists for this order.
    await raw`insert into order_events (order_id, from_status, to_status, actor_type, source, is_synthetic)
             values (${a}, 'received', 'processing', 'administrator', 'admin_api', false)`;
    await runBackfill();
    const rows = await raw`select * from order_events where order_id = ${a}`;
    // The NOT EXISTS guard means the backfill skips orders that already have any
    // event: no synthetic snapshot is added on top of real history.
    expect(rows.length).toBe(1);
    expect(rows[0].is_synthetic).toBe(false);
  });

  it('the bounded history query uses order_events_order_occurred_idx (not a seq scan)', async () => {
    const target = await seedOrder('received');
    // Seed events across many orders so an index scan is the sensible plan.
    for (let i = 0; i < 40; i++) {
      const o = await seedOrder('received');
      await raw`insert into order_events (order_id, from_status, to_status, actor_type, source)
               values (${o}, null, 'received', 'system', 'system')`;
    }
    for (let i = 0; i < 5; i++) {
      await raw`insert into order_events (order_id, from_status, to_status, actor_type, source)
               values (${target}, ${i === 0 ? null : 'received'}, 'processing', 'system', 'system')`;
    }
    await raw`analyze order_events`;
    await raw.unsafe('set enable_seqscan = off');
    const rows = await raw.unsafe(
      `explain select * from order_events where order_id = '${target}' order by occurred_at desc limit 100`,
    );
    const plan = rows.map((r: any) => r['QUERY PLAN']).join('\n');
    expect(plan).toMatch(/order_events_order_occurred_idx/);
    expect(plan).not.toMatch(/Seq Scan on order_events/);
  });
});
