import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OrderTransitionService } from '../../apps/api/src/infrastructure/orders/OrderTransitionService';
import { DrizzlePaymentRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzlePaymentRepository';
import { DomainError } from '../../apps/api/src/domain/errors/DomainError';

/**
 * P0-2 AC2 / AC3 — the canonical append-only order-event ledger, proven on real
 * PostgreSQL (not mocks) with real transactions and real concurrency.
 *
 *  AC3  every successful transition writes EXACTLY ONE event with correct
 *       from/to/actor/source, and the status change + event commit together.
 *  AC2  an illegal transition writes ZERO events and changes no status.
 *  atomicity  if the event insert fails, the status update is rolled back.
 *  concurrency  two racing identical transitions yield exactly ONE event
 *       (FOR UPDATE serialises them); an idempotency-key replay never duplicates.
 *
 * Requires DATABASE_URL (used by the service's db client) AND
 * COMMERCE_TEST_DATABASE_URL (used here to seed/inspect) to point at the SAME
 * migrated database. Skips otherwise.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('order_events ledger (real PostgreSQL, P0-2 AC2/AC3)', () => {
  let raw: any;
  const service = new OrderTransitionService();
  const createdOrders: string[] = [];

  const seedOrder = async (status: string, paymentStatus = 'unpaid'): Promise<string> => {
    const on = `oe${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [order] = await raw`
      insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status)
      values (${on}, 'T', '070', 'Kla', 'Adr', 100, 0, 100, ${status}, ${paymentStatus}) returning id`;
    createdOrders.push(order.id);
    return order.id;
  };

  const eventsFor = async (orderId: string) =>
    raw`select * from order_events where order_id = ${orderId} order by occurred_at asc, id asc`;
  const orderRow = async (orderId: string) =>
    (await raw`select status, payment_status from orders where id = ${orderId}`)[0];

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
  });

  // The outbox payload is a JSON string stored in a jsonb column (double-encoded),
  // so orderId is only reachable via the text cast, not the jsonb `->>` operator.
  const outboxFor = async (orderId: string) =>
    raw`select * from outbox_events where payload::text like ${'%' + orderId + '%'}`;

  afterEach(async () => {
    if (createdOrders.length) {
      for (const oid of createdOrders) {
        await raw`delete from outbox_events where payload::text like ${'%' + oid + '%'}`;
      }
      await raw`delete from payments where order_id = any(${createdOrders})`;
      await raw`delete from order_events where order_id = any(${createdOrders})`;
      await raw`delete from orders where id = any(${createdOrders})`;
      createdOrders.length = 0;
    }
  });

  afterAll(async () => {
    if (raw) await raw.end();
  });

  // ---- AC3 ----------------------------------------------------------------
  it('AC3: each successful transition writes exactly one correct event, atomically', async () => {
    const orderId = await seedOrder('received');
    const actorId = (await raw`select gen_random_uuid() as id`)[0].id;

    const r1 = await service.transition(orderId, 'processing', {
      actorId,
      actorType: 'administrator',
      source: 'admin_api',
      reasonCode: 'admin_transition',
    });
    expect(r1.idempotentReplay).toBe(false);
    expect((await orderRow(orderId)).status).toBe('processing');

    let events = await eventsFor(orderId);
    expect(events.length).toBe(1);
    expect(events[0].from_status).toBe('received');
    expect(events[0].to_status).toBe('processing');
    expect(events[0].actor_type).toBe('administrator');
    expect(events[0].source).toBe('admin_api');
    expect(events[0].actor_id).toBe(actorId);
    expect(events[0].is_synthetic).toBe(false);

    // A second, distinct legal transition appends exactly one more event. Two
    // transitions can share an occurred_at millisecond, so assert on the set of
    // (from -> to) edges rather than row order — the lifecycle chain is defined
    // by from/to, not by physical row order.
    await service.transition(orderId, 'completed', {
      actorType: 'administrator',
      source: 'admin_api',
    });
    events = await eventsFor(orderId);
    expect(events.length).toBe(2);
    const edges = events.map((e: any) => `${e.from_status}->${e.to_status}`).sort();
    expect(edges).toEqual(['processing->completed', 'received->processing'].sort());
  });

  it('AC3: a payment-driven transition records the provider actor and commits payment status atomically', async () => {
    const orderId = await seedOrder('received', 'unpaid');
    await service.transition(orderId, 'processing', {
      actorType: 'payment_provider',
      source: 'payment',
      reasonCode: 'pesapal_payment_completed',
      paymentStatus: 'paid',
      idempotencyKey: `pesapal:completed:${orderId}`,
    });
    const row = await orderRow(orderId);
    expect(row.status).toBe('processing');
    expect(row.payment_status).toBe('paid'); // committed in the SAME transaction
    const events = await eventsFor(orderId);
    expect(events.length).toBe(1);
    expect(events[0].actor_type).toBe('payment_provider');
    expect(events[0].source).toBe('payment');
    expect(events[0].actor_id).toBeNull(); // provider, no user id — never from a body
  });

  // ---- AC2 ----------------------------------------------------------------
  it('AC2: an illegal transition from a terminal state writes zero events and changes nothing', async () => {
    const orderId = await seedOrder('completed', 'paid');
    await expect(
      service.transition(orderId, 'received', { actorType: 'administrator', source: 'admin_api' }),
    ).rejects.toBeInstanceOf(DomainError);
    expect((await orderRow(orderId)).status).toBe('completed');
    expect((await eventsFor(orderId)).length).toBe(0);
  });

  it('AC2: the unpaid gate blocks pending_payment -> processing with zero writes', async () => {
    const orderId = await seedOrder('pending_payment', 'unpaid');
    await expect(
      service.transition(orderId, 'processing', { actorType: 'administrator', source: 'admin_api' }),
    ).rejects.toMatchObject({ category: 'FORBIDDEN' });
    const row = await orderRow(orderId);
    expect(row.status).toBe('pending_payment');
    expect(row.payment_status).toBe('unpaid');
    expect((await eventsFor(orderId)).length).toBe(0);
  });

  // ---- atomicity ----------------------------------------------------------
  it('atomicity: when the event insert fails, the status update is rolled back', async () => {
    const orderId = await seedOrder('received');
    // A source that violates order_events_source_chk. The status UPDATE runs
    // first inside the tx; the event INSERT then fails the CHECK, so the whole
    // transaction must roll back — proving status + event are one unit.
    await expect(
      service.transition(orderId, 'processing', { actorType: 'administrator', source: 'not_a_valid_source' as any }),
    ).rejects.toBeTruthy();
    expect((await orderRow(orderId)).status).toBe('received'); // rolled back
    expect((await eventsFor(orderId)).length).toBe(0);
  });

  // ---- concurrency --------------------------------------------------------
  it('concurrency: two racing identical transitions yield exactly one event', async () => {
    const orderId = await seedOrder('received');
    const key = `race:${orderId}`;
    const ctx = { actorType: 'system' as const, source: 'system' as const, idempotencyKey: key };
    const results = await Promise.allSettled([
      service.transition(orderId, 'processing', ctx),
      service.transition(orderId, 'processing', ctx),
    ]);
    // Both settle (one real write, one idempotent replay) OR one rejects if the
    // second observed the already-processing state — either way, EXACTLY ONE event.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect((await orderRow(orderId)).status).toBe('processing');
    expect((await eventsFor(orderId)).length).toBe(1);
  });

  it('concurrency/idempotency: a sequential replay with the same key returns the same event and writes no duplicate', async () => {
    const orderId = await seedOrder('received');
    const key = `replay:${orderId}`;
    const ctx = { actorType: 'system' as const, source: 'system' as const, idempotencyKey: key };
    const first = await service.transition(orderId, 'processing', ctx);
    const second = await service.transition(orderId, 'processing', ctx);
    expect(second.idempotentReplay).toBe(true);
    expect(second.eventId).toBe(first.eventId);
    expect((await eventsFor(orderId)).length).toBe(1);
  });

  // ---- webhook writer: atomic payment + status + event + outbox -----------
  it('AC3: the mobile-money webhook writer commits payment + status + event + outbox in one transaction', async () => {
    const orderId = await seedOrder('received', 'unpaid');
    const idem = `mm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const repo = new DrizzlePaymentRepository();
    await repo.recordWebhookOutcome({
      orderId,
      idempotencyKey: idem,
      provider: 'mtn',
      providerReference: 'MTN-REF-1',
      amount: 100,
      outcome: 'SUCCESS',
      signatureVerified: true,
      requiresReview: false,
    });

    const row = await orderRow(orderId);
    expect(row.status).toBe('processing');
    expect(row.payment_status).toBe('paid');

    const events = await eventsFor(orderId);
    expect(events.length).toBe(1);
    expect(events[0].actor_type).toBe('payment_provider');
    expect(events[0].source).toBe('payment');
    expect(events[0].to_status).toBe('processing');

    const pay = await raw`select * from payments where order_id = ${orderId}`;
    expect(pay.length).toBe(1);
    const outbox = await outboxFor(orderId);
    expect(outbox.length).toBe(1);
    expect(outbox[0].event_type).toBe('PAYMENT_SUCCESS');
  });

  it('AC2: a failed webhook records payment status only — no lifecycle event', async () => {
    const orderId = await seedOrder('received', 'unpaid');
    const idem = `mm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const repo = new DrizzlePaymentRepository();
    await repo.recordWebhookOutcome({
      orderId,
      idempotencyKey: idem,
      provider: 'airtel',
      providerReference: 'AIRTEL-REF-1',
      amount: 100,
      outcome: 'FAILED',
      signatureVerified: true,
      requiresReview: false,
    });
    const row = await orderRow(orderId);
    expect(row.status).toBe('received'); // NOT forced to pending_payment
    expect(row.payment_status).toBe('failed');
    expect((await eventsFor(orderId)).length).toBe(0); // no invented event
  });
});
