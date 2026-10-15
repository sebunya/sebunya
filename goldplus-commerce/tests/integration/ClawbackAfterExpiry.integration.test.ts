import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A partial refund after some points had expired took back too few: expiry entries point at the earn like a
 * reversal does, and were counted as points already clawed back. Earn 1,000, spend 600, 400 expire, refund half:
 * 100 came back instead of 500. Real PostgreSQL, real repositories, the real clawback use case.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('loyalty clawback after points expired (real PostgreSQL)', () => {
  let raw: any; let clawback: any;
  const tag = `cbx${Date.now().toString(36)}`;
  let userId = ''; let accountId = ''; let orderId = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    [{ id: userId }] = await raw`insert into users (email, password_hash) values (${`${tag}@e.com`}, 'x') returning id`;
    [{ id: accountId }] = await raw`insert into loyalty_accounts (user_id) values (${userId}) returning id`;
    [{ id: orderId }] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, status, payment_status)
      values (${`GP-${tag}`.slice(0, 20)}, 'T', '0772000000', 'Kampala', 'Plot 1', 100000, 100000, 'delivered', 'paid') returning id`;
    const [earn] = await raw`insert into loyalty_ledger_entries (account_id, type, points, order_id, reason, idempotency_key)
      values (${accountId}, 'earn', 1000, ${orderId}, 'earn', ${`earn:${tag}`}) returning id`;
    await raw`insert into loyalty_ledger_entries (account_id, type, points, reason, idempotency_key) values (${accountId}, 'redeem', -600, 'spent', ${`redeem:${tag}`})`;
    await raw`insert into loyalty_ledger_entries (account_id, type, points, reversed_entry_id, reason, idempotency_key) values (${accountId}, 'expiry', -400, ${earn.id}, 'expired', ${`expiry:${tag}`})`;
    const { DrizzleLoyaltyRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyRepository');
    const { DrizzleLoyaltyCompletionRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyCompletionRepository');
    const { DrizzleAuditRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAuditRepository');
    const { ClawbackOrderEarnUseCase } = await import('../../apps/api/src/application/use-cases/loyalty/LoyaltyCompletionUseCases');
    clawback = new ClawbackOrderEarnUseCase(new DrizzleLoyaltyRepository(), new DrizzleLoyaltyCompletionRepository(), new DrizzleAuditRepository());
  });

  // The ledger is append-only (a trigger refuses DELETE), so the uniquely tagged rows stay, as in the other suites.
  afterAll(async () => { if (raw) await raw.end({ timeout: 5 }); });

  it('half refunded takes back half the earn (500), not 500 minus the 400 that lapsed', async () => {
    const r = await clawback.execute({ orderId, cumulativeShareBps: 5_000, actorId: null, actorType: 'system', reason: 'Partial refund' });
    expect(r).toEqual({ ok: true, points: 500 });
    // Asking again for the same cumulative share takes nothing more.
    const again = await clawback.execute({ orderId, cumulativeShareBps: 5_000, actorId: null, actorType: 'system', reason: 'Partial refund' });
    expect(again.ok).toBe(false);
    const [{ sum }] = await raw`select coalesce(sum(points), 0)::int as sum from loyalty_ledger_entries where account_id = ${accountId}`;
    expect(sum).toBe(-500); // 1,000 - 600 - 400 - 500: carried negative, as the brief says
  });
});
