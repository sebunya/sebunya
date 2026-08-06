import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VerifyPesaPalPaymentUseCase } from '../../apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase';
import { ReconcilePendingPaymentsUseCase } from '../../apps/api/src/application/use-cases/payments/ReconcilePendingPaymentsUseCase';
import { SettlePaymentUseCase } from '../../apps/api/src/application/use-cases/payments/SettlePaymentUseCase';
import type { IPesaPalClient } from '../../apps/api/src/application/ports/IPesaPalClient';

/**
 * The Pesapal payment journey, against a REAL database (payments brief).
 *
 * THE COVERAGE THAT NEVER EXISTED. Of the original 111 integration tests, not
 * one touched the Pesapal rail — the IPN handler, the verify use case, the
 * attempt lifecycle. The success branch of the system's only online payment
 * path had literally never executed anywhere, in test or production, when the
 * "payments are not working" brief landed. This suite is that missing proof:
 * real DrizzlePaymentAttemptRepository (state machine enforced at the write
 * path), real OrderTransitionService (append-only order_events ledger), and a
 * provider stub standing where Pesapal's API would.
 *
 * The provider is the ONLY stub, because its live behaviour was proven
 * separately: submit → hosted page → PIN → IPN, all demonstrated against
 * Pesapal live during the 2026-08-06 reconciliation.
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('Pesapal payment journey (real PostgreSQL)', () => {
  let raw: any;
  let repo: any;
  let transition: any;
  const createdOrders: string[] = [];

  /** What the stubbed provider will answer, keyed by tracking id. */
  const providerAnswers = new Map<
    string,
    { status_code: number; description: string; amount: number; reference: string }
  >();
  const statusCalls: string[] = [];

  const stubClient: IPesaPalClient = {
    async requestToken() {
      return 'stub-token';
    },
    async getToken() {
      return 'stub-token';
    },
    async submitOrderRequest() {
      throw new Error('not used in this journey');
    },
    async getTransactionStatus(trackingId: string) {
      statusCalls.push(trackingId);
      const a = providerAnswers.get(trackingId);
      if (!a) throw new Error(`stub has no answer for ${trackingId}`);
      return {
        order_tracking_id: trackingId,
        merchant_reference: a.reference,
        amount: a.amount,
        currency: 'UGX',
        status_code: a.status_code,
        payment_status_description: a.description,
        payment_method: 'MTNUG',
        confirmation_code: a.status_code === 1 ? `CONF-${trackingId.slice(0, 6)}` : undefined,
        payment_account: '2567xx',
      };
    },
    async requestRefund() {
      return { status: '200', message: 'stub' };
    },
  } as IPesaPalClient;

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('postgres');
    raw = postgres(URL as string, { max: 2, onnotice: () => undefined });

    const { DrizzlePaymentAttemptRepository } = await import(
      '../../apps/api/src/infrastructure/db/repositories/DrizzlePaymentAttemptRepository'
    );
    const { OrderTransitionService } = await import(
      '../../apps/api/src/infrastructure/orders/OrderTransitionService'
    );
    repo = new DrizzlePaymentAttemptRepository();
    transition = new OrderTransitionService();
  });

  afterAll(async () => {
    if (!raw) return;
    if (createdOrders.length) {
      await raw`delete from payment_attempts where order_id = any(${createdOrders})`;
      await raw`delete from order_events where order_id = any(${createdOrders})`;
      await raw`delete from orders where id = any(${createdOrders})`;
    }
    await raw.end();
  });

  const seed = async (opts: { amount: number; status?: string }) => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const on = `pj${suffix}`.slice(0, 20);
    const [order] = await raw`
      insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address,
                          subtotal_amount, delivery_fee, total_amount, status, payment_status)
      values (${on}, 'Journey T', '0700000009', 'Kla', 'Adr', ${opts.amount}, 0, ${opts.amount}, ${opts.status ?? 'received'}, 'unpaid')
      returning id`;
    createdOrders.push(order.id);
    const reference = `GP-${on}-ref`;
    const trackingId = `trk-${suffix}`;
    const attempt = await repo.createPaymentAttempt({
      orderId: order.id,
      merchantReference: reference,
      amount: opts.amount,
      currency: 'UGX',
      status: 'not_started',
    });
    // The lifecycle a real start performs: not_started -> pending with the ids.
    await repo.updatePaymentAttemptStatus(attempt.id, {
      status: 'pending',
      orderTrackingId: trackingId,
      redirectUrl: `https://pay.pesapal.com/iframe/x?OrderTrackingId=${trackingId}`,
    });
    return { orderId: order.id, reference, trackingId, attemptId: attempt.id };
  };

  const verify = () => new VerifyPesaPalPaymentUseCase(repo, stubClient, transition);

  const orderRow = async (orderId: string) =>
    (await raw`select status, payment_status from orders where id = ${orderId}`)[0];
  const eventsFor = async (orderId: string) =>
    raw`select to_status, actor_type from order_events where order_id = ${orderId} order by created_at`;

  it('THE SUCCESS BRANCH: a completed provider answer pays the order, moves it to processing, and writes exactly one event', async () => {
    const { orderId, reference, trackingId, attemptId } = await seed({ amount: 50_000 });
    providerAnswers.set(trackingId, { status_code: 1, description: 'Completed', amount: 50_000, reference });

    const result = await verify().execute({ orderTrackingId: trackingId, merchantReference: reference, source: 'ipn' });
    expect(result).toMatchObject({ ok: true, status: 'completed', orderId });

    const attempt = await repo.findByTrackingId(trackingId);
    expect(attempt.status).toBe('completed');
    expect(attempt.id).toBe(attemptId);

    const order = await orderRow(orderId);
    expect(order.payment_status).toBe('paid');
    expect(order.status).toBe('processing');

    const events = await eventsFor(orderId);
    expect(events).toHaveLength(1);
    expect(events[0].actor_type).toBe('payment_provider');
  });

  it('replays change nothing: the same completed IPN twice writes no second event and stays paid', async () => {
    const { orderId, reference, trackingId } = await seed({ amount: 60_000 });
    providerAnswers.set(trackingId, { status_code: 1, description: 'Completed', amount: 60_000, reference });

    await verify().execute({ orderTrackingId: trackingId, merchantReference: reference, source: 'ipn' });
    const callsBefore = statusCalls.length;
    const replay = await verify().execute({ orderTrackingId: trackingId, merchantReference: reference, source: 'ipn' });

    expect(replay).toMatchObject({ ok: true, status: 'completed' });
    // The idempotent shortcut did not even ask the provider again.
    expect(statusCalls.length).toBe(callsBefore);
    expect(await eventsFor(orderId)).toHaveLength(1);
    expect((await orderRow(orderId)).payment_status).toBe('paid');
  });

  it('a FAILED provider answer records payment_status only — no lifecycle event, order untouched', async () => {
    const { orderId, reference, trackingId } = await seed({ amount: 25_000 });
    providerAnswers.set(trackingId, { status_code: 2, description: 'Failed', amount: 25_000, reference });

    const result = await verify().execute({ orderTrackingId: trackingId, merchantReference: reference, source: 'ipn' });
    expect(result).toMatchObject({ ok: false, status: 'failed' });

    expect((await repo.findByTrackingId(trackingId)).status).toBe('failed');
    const order = await orderRow(orderId);
    expect(order.payment_status).toBe('failed');
    expect(order.status).toBe('received'); // lifecycle NOT invented
    expect(await eventsFor(orderId)).toHaveLength(0);
  });

  it('an INVALID (abandoned page) answer resolves the attempt without inventing a lifecycle move', async () => {
    const { orderId, reference, trackingId } = await seed({ amount: 110_000 });
    providerAnswers.set(trackingId, { status_code: 0, description: 'INVALID', amount: 110_000, reference });

    await verify().execute({ orderTrackingId: trackingId, merchantReference: reference, source: 'poll' });
    expect((await repo.findByTrackingId(trackingId)).status).toBe('invalid');
    expect((await orderRow(orderId)).status).toBe('received');
    expect(await eventsFor(orderId)).toHaveLength(0);
  });

  it('an amount mismatch is an INTEGRITY VIOLATION that pays nothing, whatever the provider claims', async () => {
    const { orderId, reference, trackingId } = await seed({ amount: 50_000 });
    // Provider claims completed — for a different amount.
    providerAnswers.set(trackingId, { status_code: 1, description: 'Completed', amount: 5_000, reference });

    const result = await verify().execute({ orderTrackingId: trackingId, merchantReference: reference, source: 'ipn' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('verification_failed');
    expect((await orderRow(orderId)).payment_status).toBe('unpaid');
    expect(await eventsFor(orderId)).toHaveLength(0);
  });

  it('THE POLLER finds a payment the callback missed and settles it through the same path', async () => {
    const { orderId, reference, trackingId } = await seed({ amount: 75_000 });
    providerAnswers.set(trackingId, { status_code: 1, description: 'Completed', amount: 75_000, reference });
    // Age the attempt past the threshold: this is the customer who paid and
    // closed the tab, eleven weeks compressed into one update.
    await raw`update payment_attempts set created_at = now() - interval '2 hours' where order_tracking_id = ${trackingId}`;

    const effects: string[] = [];
    const settle = new SettlePaymentUseCase(
      verify(),
      // Minimal settlement stand-in: the saga tables are not part of this
      // journey; the ORDER-side effects above are the assertions that matter.
      { async execute() { return { kind: 'CONFIRMED', orderId, stage: 'ORDER_CONFIRMED', reason: 'PAYMENT_CONFIRMED' }; } } as never,
      {
        markFulfilmentPaid: async () => void effects.push('fulfilment'),
        settleLoyalty: async () => void effects.push('loyalty'),
        enqueueAdminEmail: async () => void effects.push('email'),
        recordMeasurement: async () => void effects.push('measurement'),
        onEffectFailed: () => undefined,
      },
    );
    const poller = new ReconcilePendingPaymentsUseCase(repo, settle, {
      pollAfterMinutes: 10,
      abandonStartFailuresAfterHours: 24,
      batchLimit: 100,
    });

    const result = await poller.execute(new Date());
    expect(result.confirmed).toBeGreaterThanOrEqual(1);
    expect((await orderRow(orderId)).payment_status).toBe('paid');
    expect((await orderRow(orderId)).status).toBe('processing');
    expect(effects).toEqual(expect.arrayContaining(['fulfilment', 'loyalty', 'email', 'measurement']));
  });

  it('the state machine holds at the real write path: a terminal attempt refuses resurrection', async () => {
    const { reference, trackingId } = await seed({ amount: 30_000 });
    providerAnswers.set(trackingId, { status_code: 2, description: 'Failed', amount: 30_000, reference });
    await verify().execute({ orderTrackingId: trackingId, merchantReference: reference, source: 'ipn' });

    const attempt = await repo.findByTrackingId(trackingId);
    await expect(repo.updatePaymentAttemptStatus(attempt.id, { status: 'pending' })).rejects.toThrow(
      /PAYMENT_STATE_ILLEGAL_TRANSITION/,
    );
  });
});
