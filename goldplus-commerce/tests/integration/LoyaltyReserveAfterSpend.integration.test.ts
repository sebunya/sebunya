import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Two orders, one balance (2026-10-07). Order A's delivery spends the points
 * between order B's balance read and B's reservation. The reservation now takes
 * the ledger's own lock and lowers its ceiling by what was spent since the read.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('a reservation cannot promise points just spent (real PostgreSQL)', () => {
  let raw: any;
  let repo: any;
  const userIds: string[] = [];

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const postgres = createRequire(import.meta.url)('postgres');
    raw = postgres(URL as string, { max: 2, onnotice: () => undefined });
    const { DrizzleLoyaltyCompletionRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyCompletionRepository');
    repo = new DrizzleLoyaltyCompletionRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    if (userIds.length) {
      const accts = (await raw`select id from loyalty_accounts where user_id = any(${userIds})`).map((r: any) => r.id);
      // Test rows only; the ledger is append-only, so its guard is bypassed for cleanup alone.
      await raw.begin(async (t: any) => {
        await t`alter table loyalty_ledger_entries disable trigger loyalty_ledger_entries_immutable`;
        await t`delete from loyalty_redemptions where account_id = any(${accts})`;
        await t`delete from loyalty_ledger_entries where account_id = any(${accts})`;
        await t`alter table loyalty_ledger_entries enable trigger loyalty_ledger_entries_immutable`;
      });
      await raw`delete from loyalty_accounts where user_id = any(${userIds})`;
      await raw`delete from users where id = any(${userIds})`;
    }
    await raw.end();
  });

  const seed = async () => {
    const [u] = await raw`insert into users (email, password_hash) values (${`lr-${crypto.randomUUID()}@x.test`}, 'h') returning id`;
    userIds.push(u.id);
    const [a] = await raw`insert into loyalty_accounts (user_id) values (${u.id}) returning id`;
    await raw`insert into loyalty_ledger_entries (account_id, type, points, reason, idempotency_key) values (${a.id}, 'adjustment', 1000, 'seed', ${'seed:' + a.id})`;
    return a.id as string;
  };
  const reserve = (accountId: string, key: string, ledgerPointsAtRead?: number) => repo.createReservation({
    maxTotalReservedPoints: 1000, ledgerPointsAtRead, accountId, orderId: null, pointsReserved: 1000,
    valueUgx: 10000, pointValueUgx: 10, idempotencyKey: key, reservedUntil: new Date(Date.now() + 3_600_000),
  });

  it('refuses when the points were spent after the balance was read', async () => {
    const acct = await seed();
    // Order A's delivery: the points are spent (ledger debit) after B read 1000.
    await raw`insert into loyalty_ledger_entries (account_id, type, points, reason, idempotency_key) values (${acct}, 'redeem', -1000, 'order A', ${'redeem:A:' + acct})`;
    expect(await reserve(acct, `B:${acct}`, 1000)).toBeNull();
  });

  it('still reserves when nothing was spent in between', async () => {
    const acct = await seed();
    expect(await reserve(acct, `C:${acct}`, 1000)).not.toBeNull();
  });
});
