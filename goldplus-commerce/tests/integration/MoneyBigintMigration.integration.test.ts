import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Applies migration 0062 verbatim to a REAL PostgreSQL and proves:
 *  - an order total beyond the int4 ceiling round-trips exactly;
 *  - negative money is rejected by the database, not just the application;
 *  - a pre-existing negative row makes VALIDATE fail loudly instead of being
 *    silently absorbed.
 *
 * Set ANALYTICS_TEST_DATABASE_URL (isolated local database) to run; the suite
 * skips visibly otherwise.
 */
const URL = process.env.ANALYTICS_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('migration 0062 — bigint money and CHECKs (real PostgreSQL)', () => {
  let client: any;

  beforeAll(async () => {
    // Dedicated connection pinned to a private schema so this suite cannot
    // clobber (or be clobbered by) other integration suites sharing the
    // database: search_path is per-connection, so the shared client is unsafe
    // here.
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    client = postgres(URL!, { max: 1, prepare: false, connection: { search_path: 'mig0062' } });
    await client.unsafe('drop schema if exists mig0062 cascade; create schema mig0062;');

    // Minimal int4 shape of the affected tables, as they were before 0062.
    await client.unsafe(`
      drop table if exists order_items, payment_attempts, payments, delivery_zones, orders cascade;
      create table orders (
        id text primary key,
        subtotal_amount integer not null,
        delivery_fee integer not null default 0,
        total_amount integer not null,
        pricing_base_subtotal integer not null default 0,
        pricing_discount_total integer not null default 0,
        pricing_tax_total integer not null default 0
      );
      create table order_items (
        id text primary key,
        order_id text references orders(id),
        quantity integer not null,
        unit_price integer not null,
        canonical_unit_price integer not null default 0,
        base_subtotal integer not null default 0,
        discount_amount integer not null default 0,
        final_line_total integer not null default 0
      );
      create table payments (id text primary key, amount integer not null);
      create table payment_attempts (id text primary key, amount integer not null);
      create table delivery_zones (id text primary key, fee_ugx integer not null);
    `);
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  it('applies cleanly and widens every money column to bigint', async () => {
    const migration = readFileSync(
      resolve(__dirname, '../../apps/api/src/infrastructure/db/migrations/0062_money_bigint_and_checks.sql'),
      'utf8',
    );
    await client.unsafe(migration);
    const columns = await client`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'mig0062' and (table_name, column_name) in (
        ('orders','total_amount'), ('order_items','unit_price'),
        ('payments','amount'), ('payment_attempts','amount'), ('delivery_zones','fee_ugx')
      )`;
    for (const column of columns) {
      expect(column.data_type, `${column.table_name}.${column.column_name}`).toBe('bigint');
    }
  });

  it('round-trips an order total beyond the int4 ceiling exactly', async () => {
    const big = 9_000_000_000; // 9 billion UGX — impossible under int4.
    await client`insert into orders (id, subtotal_amount, total_amount) values ('big', ${big}, ${big})`;
    const [row] = await client`select total_amount from orders where id = 'big'`;
    expect(Number(row.total_amount)).toBe(big);
  });

  it('rejects negative money at the database layer', async () => {
    await expect(client`
      insert into orders (id, subtotal_amount, total_amount) values ('neg', -1, 100)
    `).rejects.toThrow(/orders_money_non_negative/);
    await expect(client`
      insert into order_items (id, quantity, unit_price) values ('neg-item', 1, -5)
    `).rejects.toThrow(/order_items_money_non_negative/);
    await expect(client`
      insert into order_items (id, quantity, unit_price) values ('zero-qty', 0, 5)
    `).rejects.toThrow(/order_items_quantity_positive/);
    await expect(client`
      insert into payment_attempts (id, amount) values ('neg-pa', -100)
    `).rejects.toThrow(/payment_attempts_amount_non_negative/);
  });

  it('VALIDATE fails loudly on a pre-existing corrupt row instead of absorbing it', async () => {
    // Re-create a fresh table with a bad row, then apply just the CHECK steps.
    await client.unsafe(`
      drop table if exists corrupt_orders;
      create table corrupt_orders (id text primary key, total_amount integer not null);
      insert into corrupt_orders values ('bad', -500);
      alter table corrupt_orders
        add constraint corrupt_orders_non_negative check (total_amount >= 0) not valid;
    `);
    await expect(client.unsafe(
      'alter table corrupt_orders validate constraint corrupt_orders_non_negative',
    )).rejects.toThrow(/violated|check constraint/i);
  });
});
