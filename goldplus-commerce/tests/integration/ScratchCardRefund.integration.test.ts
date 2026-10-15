import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Owner, 2026-10-15: a fully refunded order takes its scratch card with it. Real PostgreSQL, real repositories:
 * an unplayed card is voided (and can no longer be played); a played card's prize points are reversed, carried
 * negative if already spent; running it again changes nothing.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('scratch card on a refunded order (real PostgreSQL)', () => {
  let raw: any; let uc: any; let draws: any;
  const tag = `scr${Date.now().toString(36)}`;
  let userId = ''; let accountId = ''; let campaignId = ''; let prizeId = '';
  const order = async (name: string) => {
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, status, payment_status)
      values (${`GP-${tag}-${name}`.slice(0, 20)}, 'T', '0772000000', 'Kampala', 'Plot 1', 1000, 1000, 'delivered', 'paid') returning id`;
    return o.id as string;
  };
  const token = async (orderId: string, status: string) => {
    const [t] = await raw`insert into loyalty_draw_tokens (campaign_id, user_id, account_id, source_type, source_id, status, expires_at, played_at)
      values (${campaignId}, ${userId}, ${accountId}, 'order', ${orderId}, ${status}, now() + interval '7 days', ${status === 'played' ? new Date() : null}) returning id`;
    return t.id as string;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    [{ id: userId }] = await raw`insert into users (email, password_hash) values (${`${tag}@e.com`}, 'x') returning id`;
    [{ id: accountId }] = await raw`insert into loyalty_accounts (user_id) values (${userId}) returning id`;
    [{ id: campaignId }] = await raw`insert into loyalty_draw_campaigns (code, name, trigger_event, token_expiry_days, budget_cap_points) values (${tag}, 'Test', 'order_delivered', 7, 100000) returning id`;
    [{ id: prizeId }] = await raw`insert into loyalty_draw_prizes (campaign_id, label, points_awarded, weight) values (${campaignId}, '500 points', 500, 1) returning id`;
    const { DrizzleLoyaltyDrawRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyDrawRepository');
    const { DrizzleLoyaltyRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyRepository');
    const { ReverseDrawOnRefundUseCase } = await import('../../apps/api/src/application/use-cases/loyalty/LoyaltyDrawUseCases');
    draws = new DrizzleLoyaltyDrawRepository();
    uc = new ReverseDrawOnRefundUseCase(draws, new DrizzleLoyaltyRepository());
  });
  // The ledger is append-only; tagged rows stay, as in the other loyalty suites.
  afterAll(async () => { if (raw) await raw.end({ timeout: 5 }); });

  it('an unplayed card is voided and can no longer be played', async () => {
    const orderId = await order('U');
    const tokenId = await token(orderId, 'available');
    expect(await uc.execute({ orderId, reason: 'Refund' })).toEqual({ voided: 1, reversed: 0 });
    expect((await raw`select status from loyalty_draw_tokens where id = ${tokenId}`)[0].status).toBe('expired');
    expect(await draws.claimToken(tokenId, userId, new Date())).toBeNull();
  });

  it("a played card's prize is reversed once, carried negative when spent", async () => {
    const orderId = await order('P');
    const tokenId = await token(orderId, 'played');
    const [credit] = await raw`insert into loyalty_ledger_entries (account_id, type, points, reason, idempotency_key)
      values (${accountId}, 'adjustment', 500, 'Scratch card prize', ${`draw:${tokenId}`}) returning id`;
    await raw`insert into loyalty_draw_results (token_id, campaign_id, prize_id, user_id, points_awarded, ledger_entry_id, prize_snapshot)
      values (${tokenId}, ${campaignId}, ${prizeId}, ${userId}, 500, ${credit.id}, '{}'::jsonb)`;
    await raw`insert into loyalty_ledger_entries (account_id, type, points, reason, idempotency_key) values (${accountId}, 'redeem', -500, 'spent', ${`spent:${tag}`})`;
    expect(await uc.execute({ orderId, reason: 'Refund' })).toEqual({ voided: 0, reversed: 1 });
    const [rev] = await raw`select points from loyalty_ledger_entries where reversed_entry_id = ${credit.id} and type = 'reversal'`;
    expect(rev.points).toBe(-500);
    expect(await uc.execute({ orderId, reason: 'Refund again' })).toEqual({ voided: 0, reversed: 0 }); // idempotent
  });
});
