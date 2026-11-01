import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzlePricingCapacityRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzlePricingCapacityRepository';

/**
 * U1 AC4 — a promotion with a UGX budget cap auto-pauses when consumed, and the
 * order past the budget does not receive it. Proven on real PostgreSQL through
 * the real reserve → redeem capacity flow (budget is consumed atomically with
 * redemption; once the cap is reached the version status flips to PAUSED and the
 * ACTIVE-only reservation guard rejects the next order).
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('promotion budget cap + auto-pause (real PostgreSQL, U1 AC4)', () => {
  let raw: any;
  const repo = new DrizzlePricingCapacityRepository();
  let definitionId: string;
  let versionId: string;
  const orderIds: string[] = [];
  const quoteIds: string[] = [];

  const CAP = 1000;
  const DELTA = 250; // each order consumes 250 → paused after the 4th (1000)

  const now = () => new Date();

  const seedActivePromotion = async () => {
    const [def] = await raw`
      insert into promotion_definitions (key, name, description, status)
      values (${`bud-${Date.now()}`}, 'Budget Promo', 'AC4 budget cap', 'ACTIVE') returning id`;
    definitionId = def.id;
    const [ver] = await raw`
      insert into promotion_versions (definition_id, version_number, status, conditions, benefits, exclusions, starts_at, ends_at, created_by, budget_cap_ugx, budget_consumed_ugx)
      values (${definitionId}, 1, 'ACTIVE', '[]'::jsonb, '[{"type":"FIXED_AMOUNT_OFF","value":250}]'::jsonb, '[]'::jsonb,
              ${new Date(Date.now() - 86_400_000)}, ${new Date(Date.now() + 86_400_000)}, ${cryptoId()}, ${CAP}, 0)
      returning id`;
    versionId = ver.id;
    await raw`update promotion_definitions set active_version_id = ${versionId} where id = ${definitionId}`;
  };

  function cryptoId(): string {
    // A throwaway uuid for created_by.
    return '00000000-0000-4000-8000-000000000000';
  }

  const makeOrder = async (): Promise<string> => {
    const on = `bg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [o] = await raw`
      insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status)
      values (${on}, 'T', '070', 'Kla', 'Adr', 100, 0, 100, 'received', 'unpaid') returning id`;
    orderIds.push(o.id);
    return o.id;
  };

  const makeQuoteWithDiscount = async (): Promise<string> => {
    const [q] = await raw`
      insert into pricing_quotes (base_subtotal_ugx, final_total_ugx, calculation_version, experiment_evidence, decision_trace, evaluated_at, expires_at)
      values (1000, 750, 'pricing-v1', '[]'::jsonb, '[]'::jsonb, ${now()}, ${new Date(Date.now() + 3_600_000)}) returning id`;
    quoteIds.push(q.id);
    await raw`
      insert into pricing_adjustments (quote_id, promotion_definition_id, promotion_version_id, benefit_type, amount_ugx, application_order, explanation)
      values (${q.id}, ${definitionId}, ${versionId}, 'FIXED_AMOUNT_OFF', ${DELTA}, 0, 'AC4 test discount')`;
    return q.id;
  };

  const consumedBudget = async () => {
    const row = (await raw`select budget_consumed_ugx, status from promotion_versions where id = ${versionId}`)[0];
    // postgres returns int8 (bigint) as a string.
    return { budget_consumed_ugx: Number(row.budget_consumed_ugx), status: row.status };
  };

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    await seedActivePromotion();
  });

  afterAll(async () => {
    if (!raw) return;
    if (quoteIds.length) {
      await raw`delete from promotion_redemptions where reservation_id in (select id from promotion_reservations where quote_id = any(${quoteIds}))`;
      await raw`delete from promotion_reservations where quote_id = any(${quoteIds})`;
      await raw`delete from pricing_adjustments where quote_id = any(${quoteIds})`;
      await raw`delete from pricing_quotes where id = any(${quoteIds})`;
    }
    if (orderIds.length) await raw`delete from orders where id = any(${orderIds})`;
    await raw`update promotion_definitions set active_version_id = null where id = ${definitionId}`;
    await raw`delete from promotion_versions where id = ${versionId}`;
    await raw`delete from promotion_definitions where id = ${definitionId}`;
    await raw.end();
  });

  it('consumes budget per redeemed order and auto-pauses at the cap, then refuses the next order', async () => {
    // Four orders consume the whole 1000 budget (250 each).
    for (let i = 0; i < 4; i++) {
      const quoteId = await makeQuoteWithDiscount();
      const orderId = await makeOrder();
      await repo.reserveQuote({ quoteId, idempotencyKey: `idem-${i}`, now: now() });
      await repo.redeemQuote({ quoteId, orderId, now: now() });
      const state = await consumedBudget();
      expect(state.budget_consumed_ugx).toBe((i + 1) * DELTA);
    }

    const paused = await consumedBudget();
    expect(paused.budget_consumed_ugx).toBe(CAP);
    expect(paused.status).toBe('PAUSED'); // auto-paused exactly at the cap

    // The next order cannot reserve the promotion — it is no longer ACTIVE.
    const quoteId = await makeQuoteWithDiscount();
    await expect(repo.reserveQuote({ quoteId, idempotencyKey: 'idem-over', now: now() })).rejects.toThrow('PROMOTION_NOT_ACTIVE');
  }, 30_000);
});
