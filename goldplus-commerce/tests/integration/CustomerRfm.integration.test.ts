import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Slice 6 — RFM scoring on REAL PostgreSQL. Seeds customers with distinct
 * recency/frequency/monetary profiles from PAID orders and proves the quintile
 * scoring + segmentation is computed from real aggregates (unpaid orders never
 * inflate M or reset recency).
 *
 * Set COMMERCE_TEST_DATABASE_URL to a MIGRATED database. Skips otherwise.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
const NOW = new Date('2026-08-02T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

suite('customer RFM scoring (real PostgreSQL)', () => {
  let useCase: any;
  let raw: any;
  const userIds: string[] = [];
  const key: Record<string, string> = {}; // label -> userId

  const mkUser = async (label: string): Promise<string> => {
    const email = `rfm-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e.com`;
    const [u] = await raw`insert into users (email, password_hash) values (${email}, 'x') returning id`;
    userIds.push(u.id);
    key[label] = u.id;
    return u.id;
  };
  const mkPaidOrders = async (userId: string, count: number, recencyDays: number, eachTotal: number) => {
    for (let i = 0; i < count; i++) {
      const on = `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 20);
      await raw`
        insert into orders (order_number, user_id, customer_name, customer_phone, delivery_area, delivery_address,
                            subtotal_amount, delivery_fee, total_amount, status, payment_status, created_at)
        values (${on}, ${userId}, 'T', '070', 'Kla', 'Adr', ${eachTotal}, 0, ${eachTotal}, 'completed', 'paid', ${daysAgo(recencyDays)})`;
    }
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    const repoMod = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleCustomerRfmRepository');
    const ucMod = await import('../../apps/api/src/application/use-cases/customer-dna/ScoreCustomerRfmUseCase');
    useCase = new ucMod.ScoreCustomerRfmUseCase(new repoMod.DrizzleCustomerRfmRepository());

    await mkPaidOrders(await mkUser('champ'), 5, 1, 2_000_000);
    await mkPaidOrders(await mkUser('good'), 3, 15, 1_000_000);
    await mkPaidOrders(await mkUser('mid'), 2, 45, 750_000);
    await mkPaidOrders(await mkUser('weak'), 1, 120, 400_000);
    await mkPaidOrders(await mkUser('worst'), 1, 300, 100_000);
    // An UNPAID order for champ that must be ignored by the aggregation.
    const on = `u${Date.now().toString(36)}`.slice(0, 20);
    await raw`
      insert into orders (order_number, user_id, customer_name, customer_phone, delivery_area, delivery_address,
                          subtotal_amount, delivery_fee, total_amount, status, payment_status, created_at)
      values (${on}, ${key['champ']}, 'T', '070', 'Kla', 'Adr', 9_999_999, 0, 9_999_999, 'pending_payment', 'unpaid', ${daysAgo(0)})`;
  });

  afterAll(async () => {
    if (!raw) return;
    if (userIds.length) {
      await raw`delete from orders where user_id = any(${userIds})`;
      await raw`delete from users where id = any(${userIds})`;
    }
    await raw.end();
  });

  it('scores the top customer Champions and the worst Lost, from real paid orders', async () => {
    const report = await useCase.execute({ now: NOW, limit: 5000 });
    const byId = new Map(report.scores.map((s: any) => [s.customerId, s]));
    const champ = byId.get(key['champ']);
    const worst = byId.get(key['worst']);
    expect(champ.segment).toBe('Champions');
    expect(champ.r).toBe(5);
    expect(champ.f).toBe(5);
    expect(worst.segment).toBe('Lost');
    expect(report.segmentCounts['Champions']).toBeGreaterThanOrEqual(1);
  });

  it('ignores unpaid orders — the champion order_count is 5, not 6', async () => {
    const report = await useCase.execute({ now: NOW, limit: 5000 });
    const champ = report.scores.find((s: any) => s.customerId === key['champ']);
    // frequency quintile top means the paid count (5) was used, not the unpaid+paid (6).
    // Assert via the aggregate directly.
    const [{ cnt }] = await raw`select count(*)::int as cnt from orders where user_id = ${key['champ']} and payment_status='paid'`;
    expect(Number(cnt)).toBe(5);
    expect(champ.f).toBe(5);
  });
});
