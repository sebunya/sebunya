import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Fixtures } from './helpers/fixtures';

/**
 * One provider transaction, a decline and then the payment that followed it.
 *
 * Reproduces GoldPlus's FIRST successful collection (2026-09-20, order
 * GP-202609-0B3BA402, UGX 4,000): MTN declined, the IPN wrote the attempt
 * `failed`, the customer paid the SAME PesaPal page with Airtel, and the second
 * notification could not be written because `failed` was terminal — the
 * endpoint answered 500 and the shop held the money with the order unpaid.
 *
 * Runs against a real PostgreSQL clone; only the provider's HTTP answers are
 * stubbed, because the point is what OUR state machines do with them.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('a decline followed by a real payment (real PostgreSQL)', () => {
  let raw: any;
  let repo: any;
  let productId: string;
  const orders: string[] = [];
  let fx: Fixtures;

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const postgres = createRequire(import.meta.url)('postgres');
    raw = postgres(URL as string, { max: 2, onnotice: () => undefined });
    const { DrizzlePaymentAttemptRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzlePaymentAttemptRepository');
    repo = new DrizzlePaymentAttemptRepository();
    fx = new Fixtures(raw);
    productId = (await fx.product()).id;
  });

  afterAll(async () => {
    if (!raw) return;
    if (orders.length) {
      await raw`delete from payment_attempts where order_id = any(${orders})`;
      await raw`delete from order_items where order_id = any(${orders})`;
      await raw`delete from order_events where order_id = any(${orders})`;
      await raw`delete from orders where id = any(${orders})`;
    }
    await fx?.cleanup();
    await raw.end();
  });

  const seedAttempt = async (status: string) => {
    const on = `pd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address,
      subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method)
      values (${on}, 'IT', '0700000009', 'Kla', 'Adr', 4000, 0, 4000, 'received', 'unpaid', 'pesapal') returning id`;
    orders.push(o.id);
    const [a] = await raw`insert into payment_attempts (order_id, merchant_reference, amount, status, provider, order_tracking_id)
      values (${o.id}, ${'IT-' + on}, 4000, ${status}, 'pesapal', ${crypto.randomUUID()}) returning id`;
    return { orderId: o.id as string, attemptId: a.id as string };
  };

  it('records the collection that follows a decline on the same attempt', async () => {
    const { attemptId } = await seedAttempt('failed');
    // The provider is the one saying the money moved.
    await repo.updatePaymentAttemptStatus(attemptId, { status: 'completed', providerConfirmed: true });
    expect((await raw`select status from payment_attempts where id = ${attemptId}`)[0].status).toBe('completed');
  });

  it('still refuses that move when it is not the provider speaking', async () => {
    const { attemptId } = await seedAttempt('failed');
    await expect(repo.updatePaymentAttemptStatus(attemptId, { status: 'completed' }))
      .rejects.toThrow(/PAYMENT_STATE_ILLEGAL_TRANSITION/);
    expect((await raw`select status from payment_attempts where id = ${attemptId}`)[0].status).toBe('failed');
  });

  it('a late word about the declined sibling cannot un-pay a paid order', async () => {
    // The shape that made this reachable: ONE order, TWO attempts — the decline
    // and the one that paid. The provider retries notifications per transaction.
    const { orderId, attemptId: declined } = await seedAttempt('failed');
    await raw`update orders set payment_status = 'paid' where id = ${orderId}`;
    await repo.updateOrderPaymentStatusSafely(orderId, 'failed');
    expect((await raw`select payment_status from orders where id = ${orderId}`)[0].payment_status).toBe('paid');
    // The attempt's own record still tells the truth about that attempt.
    expect((await raw`select status from payment_attempts where id = ${declined}`)[0].status).toBe('failed');
    // And a real reversal still lands.
    await repo.updateOrderPaymentStatusSafely(orderId, 'reversed');
    expect((await raw`select payment_status from orders where id = ${orderId}`)[0].payment_status).toBe('reversed');
  });

  it('lets a later attempt pay an order whose earlier attempt failed', async () => {
    const { orderId } = await seedAttempt('failed');
    await repo.updateOrderPaymentStatusSafely(orderId, 'failed');
    await repo.updateOrderPaymentStatusSafely(orderId, 'paid');
    expect((await raw`select payment_status from orders where id = ${orderId}`)[0].payment_status).toBe('paid');
  });

  it('walks the whole provider sequence a live page can report', async () => {
    const { attemptId } = await seedAttempt('pending');
    for (const status of ['invalid', 'failed', 'completed', 'reversed']) {
      await repo.updatePaymentAttemptStatus(attemptId, { status, providerConfirmed: true });
      expect((await raw`select status from payment_attempts where id = ${attemptId}`)[0].status).toBe(status);
    }
    // Reversed is final: money that went back does not come back by itself.
    await expect(repo.updatePaymentAttemptStatus(attemptId, { status: 'completed', providerConfirmed: true }))
      .rejects.toThrow(/PAYMENT_STATE_ILLEGAL_TRANSITION/);
  });
});
