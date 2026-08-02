#!/usr/bin/env node
/**
 * Measures the heaviest Commerce Analytics queries with EXPLAIN ANALYZE
 * against an isolated local PostgreSQL, on a seeded dataset large enough for
 * the plan to be meaningful.
 *
 * This exists because "bounded query" is a claim, and a claim about
 * performance that nobody measured is not evidence. It prints the real plan
 * type and execution time for each query so the handoff can quote measured
 * numbers instead of adjectives.
 *
 * Usage:
 *   ANALYTICS_TEST_DATABASE_URL=postgres://... node scripts/qa/analytics-query-performance.mjs [--rows 50000]
 *
 * It never touches production: it refuses to run against a URL that is not
 * explicitly provided for testing, and it creates its own schema.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// postgres is a dependency of apps/api, not of the repository root, so resolve
// it from there rather than requiring a root-level install for a QA script.
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const postgres = require(resolve(here, '../../apps/api/node_modules/postgres'));

const url = process.env.ANALYTICS_TEST_DATABASE_URL;
if (!url) {
  console.error('ANALYTICS_TEST_DATABASE_URL is required (isolated local database only).');
  process.exit(2);
}

const rowsArgIndex = process.argv.indexOf('--rows');
const ORDER_ROWS = rowsArgIndex > -1 ? Number(process.argv[rowsArgIndex + 1]) : 50_000;
if (!Number.isInteger(ORDER_ROWS) || ORDER_ROWS < 1_000) {
  console.error('--rows must be an integer >= 1000.');
  process.exit(2);
}

const sql = postgres(url, { max: 4, prepare: false });

// One Kampala month, matching what the API's default 30-day period asks for.
const PERIOD_START = '2026-06-30T21:00:00.000Z';
const PERIOD_END = '2026-07-31T20:59:59.999Z';

async function seed() {
  await sql.unsafe(`
    drop table if exists perf_orders, perf_payment_attempts, perf_products;
    create table perf_orders (
      id bigserial primary key,
      order_number varchar(20),
      created_at timestamptz not null,
      payment_status varchar(30) not null,
      status varchar(30) not null,
      total_amount integer not null,
      pricing_discount_total integer not null default 0,
      delivery_fee integer not null default 0
    );
    create table perf_payment_attempts (
      id bigserial primary key,
      order_id bigint,
      status varchar(30) not null,
      provider varchar(50) not null default 'pesapal',
      callback_received_at timestamptz,
      ipn_received_at timestamptz,
      created_at timestamptz not null
    );
    create table perf_products (
      id bigserial primary key,
      stock_quantity integer not null default 0,
      reserved_quantity integer not null default 0,
      reorder_point integer not null default 0
    );
  `);

  // Spread across 18 months so the period filter actually excludes most rows —
  // seeding only the period under test would flatter every plan.
  await sql.unsafe(`
    insert into perf_orders (order_number, created_at, payment_status, status, total_amount, pricing_discount_total, delivery_fee)
    select
      'GP-' || g,
      timestamptz '2025-08-01 00:00:00+00' + (random() * interval '540 days'),
      (array['paid','unpaid','failed','pending','rejected'])[1 + floor(random() * 5)],
      (array['received','processing','completed','cancelled'])[1 + floor(random() * 4)],
      (5000 + floor(random() * 500000))::int,
      floor(random() * 20000)::int,
      floor(random() * 15000)::int
    from generate_series(1, ${ORDER_ROWS}) g;

    insert into perf_payment_attempts (order_id, status, provider, callback_received_at, ipn_received_at, created_at)
    select
      1 + floor(random() * ${ORDER_ROWS}),
      (array['completed','failed','pending','success','invalid'])[1 + floor(random() * 5)],
      'pesapal',
      case when random() < 0.8 then timestamptz '2026-07-10 10:00:00+00' end,
      case when random() < 0.6 then timestamptz '2026-07-10 10:05:00+00' end,
      timestamptz '2025-08-01 00:00:00+00' + (random() * interval '540 days')
    from generate_series(1, ${Math.round(ORDER_ROWS * 1.4)}) g;

    insert into perf_products (stock_quantity, reserved_quantity, reorder_point)
    select floor(random() * 200)::int, floor(random() * 50)::int, floor(random() * 20)::int
    from generate_series(1, 5000) g;
  `);

  // The indexes production relies on for these access paths.
  await sql.unsafe(`
    create index perf_orders_created_at_idx on perf_orders (created_at);
    create index perf_payment_attempts_created_at_idx on perf_payment_attempts (created_at);
    analyze perf_orders;
    analyze perf_payment_attempts;
    analyze perf_products;
  `);
}

const QUERIES = [
  {
    name: 'order aggregates (overview KPIs)',
    text: `
      select count(*)::int,
             count(*) filter (where payment_status = 'paid')::int,
             coalesce(sum(total_amount) filter (where payment_status = 'paid'), 0)::bigint,
             coalesce(sum(total_amount), 0)::bigint,
             coalesce(sum(pricing_discount_total), 0)::bigint,
             coalesce(sum(delivery_fee), 0)::bigint,
             count(*) filter (where payment_status in ('failed','rejected','cancelled'))::int,
             count(*) filter (where status = 'completed')::int,
             count(*) filter (where status = 'cancelled')::int
      from perf_orders
      where created_at >= $1 and created_at <= $2`,
  },
  {
    name: 'daily Kampala buckets (trend)',
    text: `
      select to_char((created_at at time zone 'Africa/Kampala')::date, 'YYYY-MM-DD'),
             count(*)::int,
             count(*) filter (where payment_status = 'paid')::int,
             coalesce(sum(total_amount) filter (where payment_status = 'paid'), 0)::bigint
      from perf_orders
      where created_at >= $1 and created_at <= $2
      group by 1 order by 1`,
  },
  {
    name: 'payment attempt aggregates (join to orders)',
    text: `
      select count(*)::int,
             count(*) filter (where lower(pa.status) in ('completed','paid','success'))::int,
             count(*) filter (where pa.callback_received_at is not null)::int,
             count(*) filter (where o.payment_status = 'paid')::int
      from perf_payment_attempts pa
      left join perf_orders o on o.id = pa.order_id
      where pa.created_at >= $1 and pa.created_at <= $2`,
  },
  {
    name: 'breakdown by payment_status',
    text: `
      select payment_status, count(*)::int,
             coalesce(sum(total_amount) filter (where payment_status = 'paid'), 0)::bigint
      from perf_orders
      where created_at >= $1 and created_at <= $2
      group by 1 order by 2 desc limit 50`,
  },
  {
    name: 'paid-not-processing drilldown (limit 50)',
    text: `
      select order_number, status, payment_status, total_amount
      from perf_orders
      where created_at >= $1 and created_at <= $2
        and payment_status = 'paid' and status in ('received','pending')
      order by created_at asc limit 50`,
  },
  {
    name: 'low stock count (point in time)',
    text: `
      select count(*)::int from perf_products
      where reorder_point > 0 and greatest(stock_quantity - reserved_quantity, 0) <= reorder_point`,
    noParams: true,
  },
];

async function measure(query) {
  const explainSql = `explain (analyze, buffers, format json) ${query.text}`;
  const params = query.noParams ? [] : [PERIOD_START, PERIOD_END];
  // Two runs: the first can pay for cold cache, the second is what we report.
  await sql.unsafe(explainSql, params);
  const result = await sql.unsafe(explainSql, params);
  const plan = result[0]['QUERY PLAN'][0];
  return {
    name: query.name,
    executionMs: Math.round(plan['Execution Time'] * 100) / 100,
    planningMs: Math.round(plan['Planning Time'] * 100) / 100,
    nodeType: plan.Plan['Node Type'],
    scanType: JSON.stringify(plan.Plan).includes('"Seq Scan"') ? 'contains Seq Scan' : 'index paths only',
    rows: plan.Plan['Actual Rows'],
  };
}

try {
  console.log(`Seeding ${ORDER_ROWS} orders (+40% payment attempts, 5000 products)...`);
  await seed();
  const [{ count: orderCount }] = await sql`select count(*)::int as count from perf_orders`;
  const [{ count: attemptCount }] = await sql`select count(*)::int as count from perf_payment_attempts`;
  const [{ count: inPeriod }] = await sql`
    select count(*)::int as count from perf_orders
    where created_at >= ${PERIOD_START} and created_at <= ${PERIOD_END}`;
  console.log(`Seeded: ${orderCount} orders (${inPeriod} inside the measured period), ${attemptCount} payment attempts.\n`);

  const results = [];
  for (const query of QUERIES) results.push(await measure(query));

  const pad = (value, width) => String(value).padEnd(width);
  console.log(`${pad('query', 44)}${pad('exec ms', 10)}${pad('plan ms', 10)}${pad('rows', 8)}scan`);
  console.log('-'.repeat(96));
  for (const r of results) {
    console.log(`${pad(r.name, 44)}${pad(r.executionMs, 10)}${pad(r.planningMs, 10)}${pad(r.rows, 8)}${r.scanType}`);
  }

  const slowest = results.reduce((a, b) => (a.executionMs > b.executionMs ? a : b));
  console.log(`\nSlowest: ${slowest.name} at ${slowest.executionMs} ms.`);
  console.log(JSON.stringify({ orderCount, attemptCount, inPeriod, results }, null, 2));
} finally {
  await sql.unsafe('drop table if exists perf_orders, perf_payment_attempts, perf_products').catch(() => {});
  await sql.end({ timeout: 5 });
}
