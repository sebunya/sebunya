import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';

/**
 * The hero's loyalty meter on REAL PostgreSQL: its SQL must give the same
 * lifetime points and balance as computeLifetimePoints / computeBalance over
 * the same ledger, merged accounts included.
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('hero loyalty meter: lifetime points on real PostgreSQL', () => {
  let pg: typeof import('../../apps/api/src/infrastructure/db/client').client;
  let signals: import('../../apps/api/src/infrastructure/hero/HeroSignalsService').HeroSignalsService;
  let domain: typeof import('../../apps/api/src/domain/loyalty/LoyaltyLedger');
  let heroTierMeter: typeof import('../../apps/api/src/application/hero/HeroContentService').heroTierMeter;

  const suffix = crypto.randomBytes(5).toString('hex');
  const survivorUser = crypto.randomUUID();
  const mergedUser = crypto.randomUUID();
  const noAccountUser = crypto.randomUUID();
  const survivorAccount = crypto.randomUUID();
  const mergedAccount = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const noAccountProfileId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const ids = { earn: crypto.randomUUID(), redeem: crypto.randomUUID(), redeem2: crypto.randomUUID() };

  beforeAll(async () => {
    ({ client: pg } = await import('../../apps/api/src/infrastructure/db/client'));
    const { HeroSignalsService } = await import('../../apps/api/src/infrastructure/hero/HeroSignalsService');
    signals = new HeroSignalsService();
    domain = await import('../../apps/api/src/domain/loyalty/LoyaltyLedger');
    ({ heroTierMeter } = await import('../../apps/api/src/application/hero/HeroContentService'));

    for (const [id, tag] of [[survivorUser, 's'], [mergedUser, 'm'], [noAccountUser, 'n']]) {
      await pg`insert into users (id, email) values (${id}::uuid, ${`hl-${tag}-${suffix}@example.test`})`;
    }
    await pg`insert into loyalty_accounts (id, user_id) values (${survivorAccount}::uuid, ${survivorUser}::uuid), (${mergedAccount}::uuid, ${mergedUser}::uuid)`;
    await pg`insert into loyalty_account_merges (merged_account_id, survivor_account_id) values (${mergedAccount}::uuid, ${survivorAccount}::uuid)`;
    await pg`insert into experience_profiles (id, token_hash, customer_id) values
      (${profileId}::uuid, ${crypto.randomBytes(32).toString('hex')}, ${survivorUser}::uuid),
      (${noAccountProfileId}::uuid, ${crypto.randomBytes(32).toString('hex')}, ${noAccountUser}::uuid)`;

    // An order earn must name its order (loyalty_ledger_shape_check).
    await pg`insert into orders (id, order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount)
      values (${orderId}::uuid, ${`HL-${suffix}`}, 'Hero Lifetime', '+256700000000', 'Kampala', 'Test', 100000, 100000)`;
    const row = (id: string, account: string, type: string, points: number, key: string, reversed: string | null = null, order: string | null = null) =>
      pg`insert into loyalty_ledger_entries (id, account_id, type, points, reason, idempotency_key, reversed_entry_id, order_id)
         values (${id}::uuid, ${account}::uuid, ${type}, ${points}, 'hero lifetime test', ${`${key}:${suffix}`}, ${reversed}::uuid, ${order}::uuid)`;
    await row(ids.earn, survivorAccount, 'earn', 1000, 'earn', null, orderId);
    await row(crypto.randomUUID(), survivorAccount, 'adjustment', 300, 'mission');
    await row(crypto.randomUUID(), survivorAccount, 'adjustment', 25, 'verify');
    await row(ids.redeem, survivorAccount, 'redeem', -400, 'redeem');
    await row(crypto.randomUUID(), survivorAccount, 'reversal', -200, 'clawback', ids.earn);
    await row(ids.redeem2, survivorAccount, 'redeem', -100, 'redeem2');
    await row(crypto.randomUUID(), survivorAccount, 'reversal', 100, 'redeem-back', ids.redeem2);
    await row(crypto.randomUUID(), survivorAccount, 'adjustment', -50, 'adjust');
    await row(crypto.randomUUID(), mergedAccount, 'adjustment', 150, 'birthday');
  });

  afterAll(async () => {
    // The ledger is append-only (loyalty_ledger_entries_immutable), so its rows
    // and the accounts, order and users they reference stay; every key carries
    // this run's suffix and ids are random, so runs never collide.
    await pg`delete from experience_profiles where id in (${profileId}::uuid, ${noAccountProfileId}::uuid)`;
  });

  it('matches the domain rule: all credits and merged accounts count; spending and returned redemptions do not; reversals and corrections come off', async () => {
    const ledger = await pg`select id, account_id, type, points, idempotency_key, reversed_entry_id, created_at
      from loyalty_ledger_entries where account_id in (${survivorAccount}::uuid, ${mergedAccount}::uuid)`;
    const entries = ledger.map((r) => ({
      id: r.id, accountId: r.account_id, type: r.type, points: r.points, orderId: null, reason: '',
      idempotencyKey: r.idempotency_key, expiresAt: null, reversedEntryId: r.reversed_entry_id, createdAt: r.created_at,
    }));
    const lifetime = domain.computeLifetimePoints(entries);
    expect(lifetime).toBe(1000 + 300 + 25 - 200 - 50 + 150);
    const balance = domain.computeBalance(entries, new Date()).available;
    expect(balance).toBe(825);

    const tiers = (await pg`select name, threshold_lifetime_points as threshold from loyalty_tiers
      where active = true and threshold_lifetime_points is not null`).map((t) => ({ name: String(t.name), threshold: Number(t.threshold) }));
    const s = await signals.getSignals(profileId, []);
    expect(s.loyalty).toEqual({ points: balance, ...heroTierMeter(lifetime, tiers) });
  });

  it('a signed-in customer with no loyalty account has no meter', async () => {
    const s = await signals.getSignals(noAccountProfileId, []);
    expect(s.loyalty).toBeNull();
  });
});
