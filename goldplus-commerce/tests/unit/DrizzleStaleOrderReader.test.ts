import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { DrizzleStaleOrderReader } from '../../apps/api/src/infrastructure/db/repositories/DrizzleStaleOrderReader';

/**
 * The stale-order queries behind the payment-ops sweeps (moved out of the
 * Registry, 2026-11). These decide which unpaid orders time may cancel and
 * whose stock time may return to sale, so the rules are checked on the SQL
 * actually sent, rendered by the Postgres dialect, not on source text.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn(async (_query: unknown) => [] as unknown[]) }));
vi.mock('../../apps/api/src/infrastructure/db/client', () => ({ db: { execute: (q: unknown) => execute(q) } }));

const dialect = new PgDialect();
const CUTOFF = new Date('2026-11-10T06:00:00.000Z');

async function sent(method: 'listStaleUnpaidOrders' | 'listReservedUnpaidOrders') {
  execute.mockClear();
  await new DrizzleStaleOrderReader()[method](CUTOFF, 100);
  expect(execute).toHaveBeenCalledTimes(1);
  const query = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
  // Comments stripped, whitespace collapsed: only what Postgres evaluates.
  return { text: query.sql.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim(), params: query.params };
}

beforeEach(() => execute.mockReset().mockResolvedValue([]));

describe.each(['listStaleUnpaidOrders', 'listReservedUnpaidOrders'] as const)('%s', (method) => {
  it('binds the cutoff and the limit as parameters, never as SQL text', async () => {
    const { text, params } = await sent(method);
    expect(params).toEqual([CUTOFF, 100]);
    expect(text).toMatch(/o\.created_at < \$1/);
    expect(text).toMatch(/order by o\.created_at limit \$2$/);
  });

  it('only sweeps unpaid, pre-fulfilment, online-prepaid orders (COD and legacy are never swept by time)', async () => {
    const { text } = await sent(method);
    expect(text).toContain("o.payment_status in ('unpaid', 'failed')");
    expect(text).toContain("o.status in ('received', 'pending_payment')");
    expect(text).toContain("o.payment_method = 'pesapal'");
  });

  it('never sweeps an order with a live or confirmed payment attempt', async () => {
    const { text } = await sent(method);
    expect(text).toContain(
      "not exists ( select 1 from payment_attempts a where a.order_id = o.id and a.status in ('pending', 'verification_pending', 'verification_failed', 'completed') )",
    );
  });

  it('never sweeps an order being paid in parts', async () => {
    const { text } = await sent(method);
    expect(text).toContain("not exists (select 1 from layby_plans lp where lp.order_id = o.id and lp.status in ('active', 'paid'))");
  });

  it('returns the rows the database gave, untouched', async () => {
    const rows = [{ id: 'o-1', orderNumber: 'GP-1', status: 'received', createdAt: CUTOFF }];
    execute.mockResolvedValueOnce(rows);
    await expect(new DrizzleStaleOrderReader()[method](CUTOFF, 100)).resolves.toBe(rows);
  });
});

describe('the reservation TTL query', () => {
  it('reads only orders that hold an active reservation, once each', async () => {
    const { text } = await sent('listReservedUnpaidOrders');
    expect(text).toMatch(/^select distinct o\.id, o\.order_number as "orderNumber", o\.created_at as "createdAt" from orders o join inventory_reservations r on r\.order_id = o\.id and r\.status = 'reserved' where/);
  });
});

describe('the abandonment query', () => {
  it('returns the order status with each stale order', async () => {
    const { text } = await sent('listStaleUnpaidOrders');
    expect(text).toMatch(/^select o\.id, o\.order_number as "orderNumber", o\.status, o\.created_at as "createdAt" from orders o where/);
  });
});
