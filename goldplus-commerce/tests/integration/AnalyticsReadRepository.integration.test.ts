import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GOLDEN_CURRENT_EXPECTED,
  GOLDEN_LOW_STOCK_EXPECTED,
  GOLDEN_ORDERS,
  GOLDEN_PERIOD,
  GOLDEN_PREVIOUS_EXPECTED,
  GOLDEN_PRODUCTS,
  GOLDEN_SEARCH_EXPECTED,
  GOLDEN_SEARCH_SIGNALS,
  GOLDEN_TREND_EXPECTED,
} from '../fixtures/analytics/golden-dataset';

/**
 * These run against a REAL PostgreSQL 16, because the claim being made is that
 * the SQL aggregates — including Kampala-day bucketing via AT TIME ZONE —
 * reproduce the hand-calculated golden answers. An in-process double cannot
 * show that.
 *
 * Set ANALYTICS_TEST_DATABASE_URL to run (an isolated, disposable database;
 * the suite creates and truncates its own tables). Without it the suite
 * reports as skipped rather than silently passing.
 */
const URL = process.env.ANALYTICS_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('DrizzleAnalyticsReadRepository (real PostgreSQL)', () => {
  let repo: import('../../apps/api/src/application/ports/IAnalyticsReadRepository').IAnalyticsReadRepository;
  let closeDb: () => Promise<void>;
  let periodStart: Date;
  let periodEnd: Date;
  let previousStart: Date;
  let previousEnd: Date;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    // Import after DATABASE_URL is set: the db client reads it at module load.
    const { client } = await import('../../apps/api/src/infrastructure/db/client');
    const { DrizzleAnalyticsReadRepository } = await import(
      '../../apps/api/src/infrastructure/db/repositories/DrizzleAnalyticsReadRepository'
    );
    const { resolveKampalaPeriod } = await import('../../packages/shared/src/analytics/kampala-time');

    closeDb = async () => { await client.end({ timeout: 5 }); };

    // Production column subset used by the repository's queries.
    await client`drop table if exists orders`;
    await client`create table if not exists orders (
      id text primary key,
      order_number varchar(20),
      created_at timestamptz not null,
      payment_status varchar(30) not null,
      status varchar(30) not null,
      total_amount integer not null,
      pricing_discount_total integer not null default 0,
      delivery_fee integer not null default 0
    )`;
    await client`create table if not exists products (
      id text primary key,
      stock_quantity integer not null default 0,
      reserved_quantity integer not null default 0,
      reorder_point integer not null default 0
    )`;
    await client`create table if not exists search_demand_signals (
      id serial primary key,
      query varchar(120) not null,
      search_count integer not null default 0,
      zero_result_count integer not null default 0,
      last_searched_at timestamptz not null default now()
    )`;
    await client`drop table if exists payment_attempts`;
    await client`create table if not exists payment_attempts (
      id serial primary key,
      order_id text,
      status varchar(30) not null default 'not_started',
      provider varchar(50) not null default 'pesapal',
      callback_received_at timestamptz,
      ipn_received_at timestamptz,
      created_at timestamptz not null default now()
    )`;
    await client`truncate orders, products, search_demand_signals, payment_attempts`;

    for (const order of GOLDEN_ORDERS) {
      await client`insert into orders (id, order_number, created_at, payment_status, status, total_amount, pricing_discount_total, delivery_fee)
        values (${order.id}, ${order.id}, ${order.createdAtUtc}, ${order.paymentStatus}, ${order.orderStatus}, ${order.totalAmount}, ${order.pricingDiscountTotal}, ${order.deliveryFee})`;
    }
    for (const product of GOLDEN_PRODUCTS) {
      await client`insert into products (id, stock_quantity, reserved_quantity, reorder_point)
        values (${product.id}, ${product.stockQuantity}, ${product.reservedQuantity}, ${product.reorderPoint})`;
    }
    for (const signal of GOLDEN_SEARCH_SIGNALS) {
      await client`insert into search_demand_signals (query, search_count, zero_result_count)
        values (${signal.query}, ${signal.searchCount}, ${signal.zeroResultCount})`;
    }
    // Hand-counted attempt ledger for the July period:
    //   confirmed 2 (completed, success) · failed 1 · pending 1 · unrecognised 1
    //   callbacks 3 · ipn 2 · reconciled 2 (attempts on paid orders G1, G2)
    for (const attempt of [
      { orderId: 'G1', status: 'completed', callback: true, ipn: true },
      { orderId: 'G2', status: 'success', callback: true, ipn: true },
      { orderId: 'G3', status: 'failed', callback: true, ipn: false },
      { orderId: 'G4', status: 'pending', callback: false, ipn: false },
      { orderId: 'G5', status: 'quantum_superposition', callback: false, ipn: false },
    ]) {
      await client`insert into payment_attempts (order_id, status, provider, callback_received_at, ipn_received_at, created_at)
        values (${attempt.orderId}, ${attempt.status}, 'pesapal',
                ${attempt.callback ? '2026-07-10T10:00:00.000Z' : null},
                ${attempt.ipn ? '2026-07-10T10:05:00.000Z' : null},
                '2026-07-10T09:00:00.000Z')`;
    }

    const period = resolveKampalaPeriod({ startDate: GOLDEN_PERIOD.startDate, endDate: GOLDEN_PERIOD.endDate });
    periodStart = period.start;
    periodEnd = period.end;
    previousStart = period.previousStart;
    previousEnd = period.previousEnd;
    repo = new DrizzleAnalyticsReadRepository();
  });

  afterAll(async () => {
    await closeDb?.();
  });

  it('reproduces the hand-calculated current-period aggregates in SQL', async () => {
    const aggregates = await repo.orderAggregates(periodStart, periodEnd);
    expect(aggregates).toEqual({
      orders: GOLDEN_CURRENT_EXPECTED.orders,
      paidOrders: GOLDEN_CURRENT_EXPECTED.paidOrders,
      paidOrderValueUgx: GOLDEN_CURRENT_EXPECTED.paidOrderValueUgx,
      grossOrderValueUgx: GOLDEN_CURRENT_EXPECTED.grossOrderValueUgx,
      discountValueUgx: GOLDEN_CURRENT_EXPECTED.discountValueUgx,
      deliveryFeeValueUgx: GOLDEN_CURRENT_EXPECTED.deliveryFeeValueUgx,
      failedPayments: GOLDEN_CURRENT_EXPECTED.failedPayments,
      completedOrders: GOLDEN_CURRENT_EXPECTED.completedOrders,
      cancelledOrders: GOLDEN_CURRENT_EXPECTED.cancelledOrders,
    });
  });

  it('reproduces the hand-calculated comparison-window aggregates in SQL', async () => {
    const aggregates = await repo.orderAggregates(previousStart, previousEnd);
    expect(aggregates.orders).toBe(GOLDEN_PREVIOUS_EXPECTED.orders);
    expect(aggregates.paidOrders).toBe(GOLDEN_PREVIOUS_EXPECTED.paidOrders);
    expect(aggregates.paidOrderValueUgx).toBe(GOLDEN_PREVIOUS_EXPECTED.paidOrderValueUgx);
    expect(aggregates.failedPayments).toBe(GOLDEN_PREVIOUS_EXPECTED.failedPayments);
  });

  it('buckets Kampala midnight boundaries onto the correct local day in SQL', async () => {
    const buckets = await repo.dailyOrderBuckets(periodStart, periodEnd);
    const byDay = new Map(buckets.map((bucket) => [bucket.day, bucket]));
    for (const [day, expected] of Object.entries(GOLDEN_TREND_EXPECTED)) {
      const bucket = byDay.get(day);
      expect(bucket, day).toBeDefined();
      expect(bucket!.orders, day).toBe(expected.orders);
      expect(bucket!.paidOrders, day).toBe(expected.paidOrders);
      expect(bucket!.paidOrderValueUgx, day).toBe(expected.paidOrderValueUgx);
    }
    // The 30 June order (20:30Z, 23:30 Kampala) must NOT appear in July buckets.
    expect(byDay.has('2026-06-30')).toBe(false);
  });

  it('counts low stock exactly per the domain rule', async () => {
    expect(await repo.lowStockCount()).toBe(GOLDEN_LOW_STOCK_EXPECTED);
  });

  it('sums search demand to the hand-calculated totals', async () => {
    const summary = await repo.searchDemandSummary();
    expect(summary.totalSearches).toBe(GOLDEN_SEARCH_EXPECTED.totalSearches);
    expect(summary.zeroResultSearches).toBe(GOLDEN_SEARCH_EXPECTED.zeroResultSearches);
    expect(summary.lastSignalAt).not.toBeNull();
  });

  it('aggregates the payment-attempt ledger with an explicit unrecognised bucket', async () => {
    const payments = await repo.paymentAggregates(periodStart, periodEnd);
    expect(payments.attempts).toBe(5);
    expect(payments.confirmed).toBe(2);
    expect(payments.failed).toBe(1);
    expect(payments.pending).toBe(1);
    // The unknown status is counted separately, never folded into success or failure.
    expect(payments.unrecognised).toBe(1);
    expect(payments.confirmed + payments.failed + payments.pending + payments.unrecognised).toBe(payments.attempts);
    expect(payments.callbackReceived).toBe(3);
    expect(payments.ipnReceived).toBe(2);
    // G1 and G2 are the paid golden orders.
    expect(payments.reconciled).toBe(2);
    expect(payments.byProvider[0]).toEqual({ provider: 'pesapal', attempts: 5, confirmed: 2 });
  });

  it('drills into paid-but-unprocessed orders without exposing customer fields', async () => {
    // G6 and G7 are paid with status 'received' in the golden dataset.
    const rows = await repo.paidNotProcessingOrders(periodStart, periodEnd, 50, new Date('2026-08-02T00:00:00Z'));
    expect(rows.map((r) => r.orderNumber).sort()).toEqual(['G6', 'G7']);
    const serialised = JSON.stringify(rows).toLowerCase();
    for (const forbidden of ['customer', 'phone', 'email', 'address']) {
      expect(serialised).not.toContain(forbidden);
    }
    expect(rows[0]!.ageHours).toBeGreaterThan(0);
  });

  it('breaks orders down by an allowlisted dimension', async () => {
    const rows = await repo.ordersByDimension(periodStart, periodEnd, 'payment_status');
    const byValue = new Map(rows.map((r) => [r.value, r.orders]));
    expect(byValue.get('paid')).toBe(4);
    expect(byValue.get('failed')).toBe(1);
    expect(rows.reduce((sum, r) => sum + r.orders, 0)).toBe(7);
  });

  it('reports source recency from real max() probes', async () => {
    const recency = await repo.sourceRecency();
    expect(recency.lastOrderAt?.toISOString()).toBe('2026-07-31T20:30:00.000Z');
    expect(recency.lastPaymentAttemptAt).not.toBeNull();
    expect(recency.lastSearchSignalAt).not.toBeNull();
  });
});
