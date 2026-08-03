import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzlePricingCapacityRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzlePricingCapacityRepository';

/**
 * U1 AC6 — refunding an order reverses the budget consumption (and the coupon
 * redemption count is reversed by DrizzleCouponRepository.reverse, proven in the
 * coupon suites). Proven on real PostgreSQL, idempotently.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('promotion budget reversal on refund (real PostgreSQL, U1 AC6)', () => {
  let raw: any;
  const repo = new DrizzlePricingCapacityRepository();
  let definitionId: string;
  let versionId: string;
  const orderIds: string[] = [];
  const quoteIds: string[] = [];
  const DELTA = 300;
  const now = () => new Date();

  const makeOrder = async (): Promise<string> => {
    const on = `br${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status)
      values (${on}, 'T', '070', 'Kla', 'Adr', 100, 0, 100, 'received', 'unpaid') returning id`;
    orderIds.push(o.id);
    return o.id;
  };
  const makeQuote = async (): Promise<string> => {
    const [q] = await raw`insert into pricing_quotes (base_subtotal_ugx, final_total_ugx, calculation_version, experiment_evidence, decision_trace, evaluated_at, expires_at)
      values (1000, 700, 'pricing-v1', '[]'::jsonb, '[]'::jsonb, ${now()}, ${new Date(Date.now() + 3_600_000)}) returning id`;
    quoteIds.push(q.id);
    await raw`insert into pricing_adjustments (quote_id, promotion_definition_id, promotion_version_id, benefit_type, amount_ugx, application_order, explanation)
      values (${q.id}, ${definitionId}, ${versionId}, 'FIXED_AMOUNT_OFF', ${DELTA}, 0, 'AC6')`;
    return q.id;
  };
  const consumed = async () => Number((await raw`select budget_consumed_ugx from promotion_versions where id = ${versionId}`)[0].budget_consumed_ugx);

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    const [def] = await raw`insert into promotion_definitions (key, name, description, status) values (${`br-${Date.now()}`}, 'Budget Reversal', 'AC6', 'ACTIVE') returning id`;
    definitionId = def.id;
    const [ver] = await raw`insert into promotion_versions (definition_id, version_number, status, conditions, benefits, exclusions, starts_at, ends_at, created_by, budget_cap_ugx, budget_consumed_ugx)
      values (${definitionId}, 1, 'ACTIVE', '[]'::jsonb, '[{"type":"FIXED_AMOUNT_OFF","value":300}]'::jsonb, '[]'::jsonb, ${new Date(Date.now() - 86_400_000)}, ${new Date(Date.now() + 86_400_000)}, ${'00000000-0000-4000-8000-000000000000'}, 10000, 0) returning id`;
    versionId = ver.id;
    await raw`update promotion_definitions set active_version_id = ${versionId} where id = ${definitionId}`;
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

  it('restores consumed budget on refund and is idempotent', async () => {
    const quoteId = await makeQuote();
    const orderId = await makeOrder();
    await repo.reserveQuote({ quoteId, idempotencyKey: 'idem-r', now: now() });
    await repo.redeemQuote({ quoteId, orderId, now: now() });
    expect(await consumed()).toBe(DELTA); // budget consumed by the redemption

    const first = await repo.reverseRedemption({ quoteId, now: now() });
    expect(first.reversed).toBe(true);
    expect(await consumed()).toBe(0); // budget restored

    const second = await repo.reverseRedemption({ quoteId, now: now() }); // idempotent
    expect(second.reversed).toBe(false);
    expect(await consumed()).toBe(0); // not driven negative
  }, 30_000);
});
