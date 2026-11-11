import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { DrizzlePaymentHealthReader } from '../../apps/api/src/infrastructure/db/repositories/DrizzlePaymentHealthReader';

/**
 * The payment-health reads behind the silence alarms and the admin funnel
 * (moved out of the Registry, 2026-11). Checked on the SQL actually sent,
 * rendered by the Postgres dialect, and on how rows become answers.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn(async (_query: unknown) => [] as unknown[]) }));
vi.mock('../../apps/api/src/infrastructure/db/client', () => ({ db: { execute: (q: unknown) => execute(q) } }));

const dialect = new PgDialect();
const reader = new DrizzlePaymentHealthReader();
const SINCE = new Date('2026-11-10T00:00:00.000Z');
const OLDER_THAN = new Date('2026-11-11T08:00:00.000Z');

function lastQuery() {
  const query = dialect.sqlToQuery(execute.mock.calls.at(-1)![0] as SQL);
  return { text: query.sql.replace(/\s+/g, ' ').trim(), params: query.params };
}

beforeEach(() => execute.mockReset().mockResolvedValue([]));

describe('lastSuccessfulPaymentAt', () => {
  it('is the newest completed attempt', async () => {
    execute.mockResolvedValueOnce([{ t: '2026-11-11T07:42:10.000Z' }]);
    await expect(reader.lastSuccessfulPaymentAt()).resolves.toEqual(new Date('2026-11-11T07:42:10.000Z'));
    expect(lastQuery()).toEqual({ text: "select max(updated_at) as t from payment_attempts where status = 'completed'", params: [] });
  });

  it('is null when money has never landed', async () => {
    execute.mockResolvedValueOnce([{ t: null }]);
    await expect(reader.lastSuccessfulPaymentAt()).resolves.toBeNull();
    execute.mockResolvedValueOnce([]);
    await expect(reader.lastSuccessfulPaymentAt()).resolves.toBeNull();
  });
});

describe('callbackSilence', () => {
  it('counts attempts that reached the provider in the window, and those never called back', async () => {
    execute.mockResolvedValueOnce([{ total: 9, awaiting: 9 }]);
    await expect(reader.callbackSilence(OLDER_THAN, SINCE)).resolves.toEqual({ awaiting: 9, total: 9 });
    const { text, params } = lastQuery();
    expect(params).toEqual([SINCE, OLDER_THAN]);
    expect(text).toContain('count(*) filter ( where ipn_received_at is null and callback_received_at is null )::int as awaiting');
    expect(text).toMatch(/where created_at >= \$1 and created_at <= \$2 and order_tracking_id is not null$/);
  });

  it('reads an empty window as nothing awaited', async () => {
    await expect(reader.callbackSilence(OLDER_THAN, SINCE)).resolves.toEqual({ awaiting: 0, total: 0 });
  });
});

describe('funnel', () => {
  it('reads the four counters for one window, each bound to the same instant', async () => {
    execute.mockResolvedValueOnce([{ started: 40, requested: 31, succeeded: 22, paid: 21 }]);
    await expect(reader.funnel(SINCE)).resolves.toEqual({ checkoutStarted: 40, paymentRequested: 31, paymentSucceeded: 22, orderPaid: 21 });
    const { text, params } = lastQuery();
    expect(params).toEqual([SINCE, SINCE, SINCE, SINCE]);
    expect(text).toContain('(select count(*) from checkout_idempotency where created_at >= $1)::int as started');
    expect(text).toContain('(select count(*) from payment_attempts where created_at >= $2)::int as requested');
    expect(text).toContain("(select count(*) from payment_attempts where status = 'completed' and updated_at >= $3)::int as succeeded");
    expect(text).toContain("(select count(*) from orders where payment_status = 'paid' and updated_at >= $4)::int as paid");
  });

  it('reads an empty answer as zeros, not as missing counters', async () => {
    await expect(reader.funnel(SINCE)).resolves.toEqual({ checkoutStarted: 0, paymentRequested: 0, paymentSucceeded: 0, orderPaid: 0 });
  });
});
