import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * Two Pay taps submit one attempt to Pesapal twice and get two tracking ids. The second write used to replace the
 * first, so a payment on the page the customer saw could match nothing (2026-10-22). recordFirstSubmission: the
 * first writer wins; the second learns it lost. Real PostgreSQL.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('two submissions of one attempt (real PostgreSQL)', () => {
  let raw: any;
  let repo: any;
  const tag = randomUUID().slice(0, 8);
  let orderId = ''; let attemptId = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    [{ id: orderId }] = await raw`
      insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, status, payment_status, payment_method, subtotal_amount, delivery_fee, total_amount)
      values (${`GP-PT${tag}`}, 'Test', '+256700000001', 'Kampala', 'Plot 1', 'pending_payment', 'unpaid', 'pesapal', 50000, 0, 50000) returning id`;
    [{ id: attemptId }] = await raw`insert into payment_attempts (order_id, merchant_reference, amount, status) values (${orderId}, ${`PT-${tag}`}, 50000, 'not_started') returning id`;
    const { DrizzlePaymentAttemptRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzlePaymentAttemptRepository');
    repo = new DrizzlePaymentAttemptRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from payment_attempts where id = ${attemptId}`;
    await raw`delete from orders where id = ${orderId}`;
    await raw.end({ timeout: 5 });
  });

  it('the first tracking id stays; the second request is told it lost', async () => {
    const [a, b] = await Promise.all([
      repo.recordFirstSubmission(attemptId, { orderTrackingId: `T1-${tag}`, redirectUrl: 'https://pay/1' }),
      repo.recordFirstSubmission(attemptId, { orderTrackingId: `T2-${tag}`, redirectUrl: 'https://pay/2' }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const [row] = await raw`select order_tracking_id from payment_attempts where id = ${attemptId}`;
    expect(row.order_tracking_id).toBe((a ?? b).orderTrackingId);
  });
});
