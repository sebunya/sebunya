import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Measurement core (0140) against a REAL PostgreSQL (dossier GP-EVT / GP-DLV).
 * Runs on a disposable clone of production (scripts/integration-on-clone.sh);
 * the only stub is the provider's HTTP endpoint (fetchImpl).
 *
 * Covers: EVT-01 (replayed transition → one event), CON-02 (same transition,
 * different content → quarantined conflict), D-008 (measurement failure never
 * rolls back commerce), router fan-out + cancellation withdrawal, DLV-06 (stale
 * generation sends nothing), DLV-04/05 (lease expiry before/after STARTED),
 * DLV-13-style hold (kill switch: no network call), accepted/unknown outcomes.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('measurement core (real PostgreSQL)', () => {
  let raw: any;
  let transition: any;
  let M: any; // DeliveryService
  let W: any; // BusinessEventWriter
  let dbc: any;
  const orders: string[] = [];
  let productId: string;

  beforeAll(async () => {
    process.env.MEASUREMENT_ALLOW_NONPROD_DELIVERY = 'true';
    const { createRequire } = await import('node:module');
    const postgres = createRequire(import.meta.url)('postgres');
    raw = postgres(URL as string, { max: 2, onnotice: () => undefined });
    ({ OrderTransitionService: transition } = await import('../../apps/api/src/infrastructure/orders/OrderTransitionService'));
    transition = new transition();
    M = await import('../../apps/api/src/infrastructure/measurement/DeliveryService');
    W = await import('../../apps/api/src/infrastructure/measurement/BusinessEventWriter');
    ({ db: dbc } = await import('../../apps/api/src/infrastructure/db/client'));
    productId = (await raw`select id from products limit 1`)[0].id;
    await raw`delete from measurement.control where key = 'kill_switch'`;
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from measurement.control where key in ('kill_switch','it-d008')`;
    if (orders.length) {
      const evs = (await raw`select event_id from measurement.business_event where aggregate_id = any(${orders})`).map((r: any) => r.event_id);
      if (evs.length) {
        await raw`delete from measurement.delivery_attempt where delivery_id in (select delivery_id from measurement.delivery_intent where event_id = any(${evs}))`;
        await raw`delete from measurement.delivery_intent where event_id = any(${evs})`;
        await raw`delete from measurement.event_routing where event_id = any(${evs})`;
        await raw`delete from measurement.event_conflict where original_event_id = any(${evs})`;
        await raw`delete from measurement.commercial_entry where event_id = any(${evs})`;
        await raw`delete from measurement.business_event where event_id = any(${evs})`;
      }
      await raw`delete from measurement.touchpoint where anonymous_id like 'it-touch-%'`;
      await raw`delete from measurement.collector_batch where page_instance_id = 'it-collector'`;
      await raw`delete from payment_refunds where order_id = any(${orders})`;
      await raw`delete from payment_attempts where order_id = any(${orders})`;
      await raw`delete from order_attribution where order_id = any(${orders})`;
      await raw`delete from order_events where order_id = any(${orders})`;
      await raw`delete from order_items where order_id = any(${orders})`;
      await raw`delete from orders where id = any(${orders})`;
    }
    await raw.end();
  });

  const seed = async () => {
    const on = `it${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address,
      subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method)
      values (${on}, 'IT', '0700000009', 'Kla', 'Adr', 90000, 5000, 95000, 'received', 'unpaid', 'pesapal') returning id`;
    await raw`insert into order_items (order_id, product_id, sku, product_name, quantity, unit_price, final_line_total, cogs_snapshot_ugx)
      values (${o.id}, ${productId}, 'IT-SKU', 'IT item', 2, 45000, 90000, 55000)`;
    // The visitor as checkout records it (GA4 needs a client id; without one
    // the delivery is SUPPRESSED(IDENTITY_UNAVAILABLE), never sent with an invented visitor).
    await raw`insert into order_attribution (order_id, order_number, fp_client_id, client_ip, user_agent)
      values (${o.id}, ${on}, ${'fp.1700000000000.00000000-0000-4000-8000-' + on.padEnd(12, '0').slice(0, 12)}, '41.84.203.125', 'Mozilla/5.0 IT')`;
    orders.push(o.id);
    return { id: o.id as string, number: on };
  };
  const pay = (orderId: string, key: string) => transition.transition(orderId, 'processing', {
    actorType: 'payment_provider', source: 'payment', reasonCode: 'pesapal_payment_completed', paymentStatus: 'paid', idempotencyKey: key });
  const eventsOf = (orderId: string) => raw`select event_id, event_name, canonical_sha256, payload from measurement.business_event where aggregate_id = ${orderId} order by recorded_at`;
  const intentsOf = async (orderId: string) => raw`select i.* from measurement.delivery_intent i join measurement.business_event e using (event_id) where e.aggregate_id = ${orderId} order by i.created_at`;

  it('EVT-01: a verified payment replayed 10 times is ONE order_confirmed event with a routing row', async () => {
    const o = await seed();
    for (let i = 0; i < 10; i++) await pay(o.id, `pesapal:completed:it-${o.id}`);
    const evs = await eventsOf(o.id);
    expect(evs.map((e: any) => e.event_name)).toEqual(['order_confirmed']);
    expect(evs[0].payload).toMatchObject({ orderNumber: o.number, netMerchandiseUGX: '90000', collectedDeliveryUGX: '5000', confirmationBasis: 'payment_verified' });
    expect((await raw`select state from measurement.event_routing where event_id = ${evs[0].event_id}`)[0].state).toBe('PENDING');
  });

  it('CON-02: same source transition with DIFFERENT content is quarantined, not a second event', async () => {
    const o = await seed();
    await pay(o.id, `pesapal:completed:it-${o.id}`);
    const [ev] = await eventsOf(o.id);
    const orderEventId = (await raw`select id from order_events where order_id = ${o.id} and to_status = 'processing'`)[0].id;
    await dbc.transaction((tx: any) => W.appendBusinessEvent(tx, { eventName: 'order_confirmed', orderId: o.id, sourceTransitionId: `order_event:${orderEventId}`,
      data: { ...ev.payload, netMerchandiseUGX: '1' }, occurredAt: new Date() }));
    expect((await eventsOf(o.id)).length).toBe(1);
    expect((await raw`select count(*)::int n from measurement.event_conflict where original_event_id = ${ev.event_id}`)[0].n).toBe(1);
  });

  it('D-008: a failing measurement write never rolls back the commerce change', async () => {
    await dbc.transaction(async (tx: any) => {
      // drizzle-orm is an apps/api dependency: resolve it from there.
      const { createRequire } = await import('node:module');
      const { sql } = createRequire(new globalThis.URL('../../apps/api/package.json', import.meta.url))('drizzle-orm');
      await tx.execute(sql`insert into measurement.control (key, value) values ('it-d008', 'true'::jsonb) on conflict (key) do nothing`);
      await W.guardedMeasurementWrite(tx, 'it-agg', 'it-context', async () => { throw new Error('boom'); });
    });
    expect((await raw`select count(*)::int n from measurement.control where key = 'it-d008'`)[0].n).toBe(1);
    expect((await raw`select count(*)::int n from measurement.write_failure where aggregate_id = 'it-agg' and error = 'boom'`)[0].n).toBeGreaterThanOrEqual(1);
    await raw`delete from measurement.write_failure where aggregate_id = 'it-agg'`;
  });

  it('router → one GA4 intent; stale generation sends nothing; the right generation is ACCEPTED with a finished attempt', async () => {
    const o = await seed();
    await pay(o.id, `pesapal:completed:it-${o.id}`);
    await M.routeBusinessEvents();
    const [intent] = await intentsOf(o.id);
    expect(intent).toMatchObject({ sink_key: 'ga4:purchase', state: 'PENDING', provider_event_id: `purchase:${o.number}` });
    const jobs: any[] = [];
    await M.scheduleDueDeliveries(async (jobId: string, data: any) => { jobs.push({ jobId, ...data }); return true; });
    const job = jobs.find((j) => j.deliveryId === intent.delivery_id);
    expect(job.jobId).toBe(`gp-${intent.delivery_id}-g1`);
    let calls = 0;
    const ok = (async () => { calls++; return new Response(null, { status: 204 }); }) as any;
    expect(await M.deliverOne(intent.delivery_id, 0, ok)).toBe('NOT_CLAIMED'); // DLV-06
    expect(calls).toBe(0);
    expect(await M.deliverOne(intent.delivery_id, 1, ok)).toBe('ACCEPTED');
    expect(calls).toBe(1);
    const att = await raw`select outcome, http_status, finished_at from measurement.delivery_attempt where delivery_id = ${intent.delivery_id}`;
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ outcome: 'ACCEPTED', http_status: 204 });
    expect(await M.deliverOne(intent.delivery_id, 1, ok)).toBe('NOT_CLAIMED'); // terminal: never resent
  });

  it('timeout after send → UNKNOWN_OUTCOME → safe retry for GA4 (provider dedupe), never success', async () => {
    const o = await seed();
    await pay(o.id, `pesapal:completed:it-${o.id}`);
    await M.routeBusinessEvents();
    const [intent] = await intentsOf(o.id);
    await raw`update measurement.delivery_intent set enqueue_generation = 5 where delivery_id = ${intent.delivery_id}`;
    const timeout = (async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); }) as any;
    expect(await M.deliverOne(intent.delivery_id, 5, timeout)).toBe('UNKNOWN_OUTCOME');
    await M.recoverExpiredLeases();
    expect((await raw`select state, state_reason from measurement.delivery_intent where delivery_id = ${intent.delivery_id}`)[0])
      .toEqual({ state: 'RETRY_WAIT', state_reason: 'UNKNOWN_RETRY_SAFE_PROVIDER_DEDUPE' });
  });

  it('DLV-04/05: an expired lease returns to PENDING before STARTED, becomes UNKNOWN after it', async () => {
    const o = await seed();
    await pay(o.id, `pesapal:completed:it-${o.id}`);
    await M.routeBusinessEvents();
    const [intent] = await intentsOf(o.id);
    const t1 = '11111111-1111-4111-8111-111111111111';
    await raw`update measurement.delivery_intent set state = 'LEASED', lease_token = ${t1}, lease_until = now() - interval '1 minute' where delivery_id = ${intent.delivery_id}`;
    await M.recoverExpiredLeases();
    expect((await raw`select state from measurement.delivery_intent where delivery_id = ${intent.delivery_id}`)[0].state).toBe('PENDING');
    const t2 = '22222222-2222-4222-8222-222222222222';
    await raw`update measurement.delivery_intent set state = 'LEASED', lease_token = ${t2}, lease_until = now() - interval '1 minute', attempt_count = 1 where delivery_id = ${intent.delivery_id}`;
    await raw`insert into measurement.delivery_attempt (attempt_id, delivery_id, attempt_no, lease_token, adapter_version, started_at, outcome)
      values (gen_random_uuid(), ${intent.delivery_id}, 1, ${t2}, 'it', now(), 'STARTED')`;
    const r = await M.recoverExpiredLeases();
    expect(r.toUnknown).toBeGreaterThanOrEqual(1);
  });

  it('kill switch holds deliveries with no network call', async () => {
    const o = await seed();
    await pay(o.id, `pesapal:completed:it-${o.id}`);
    await M.routeBusinessEvents();
    const [intent] = await intentsOf(o.id);
    await raw`insert into measurement.control (key, value) values ('kill_switch', 'true'::jsonb) on conflict (key) do update set value = 'true'::jsonb`;
    await raw`update measurement.delivery_intent set enqueue_generation = 3 where delivery_id = ${intent.delivery_id}`;
    let calls = 0;
    expect(await M.deliverOne(intent.delivery_id, 3, (async () => { calls++; return new Response(null, { status: 204 }); }) as any)).toBe('HELD');
    expect(calls).toBe(0);
    expect((await raw`select state, state_reason from measurement.delivery_intent where delivery_id = ${intent.delivery_id}`)[0]).toEqual({ state: 'RETRY_WAIT', state_reason: 'KILL_SWITCH' });
    await raw`delete from measurement.control where key = 'kill_switch'`;
  });

  it('cancellation withdraws unsent deliveries and refunds an ACCEPTED GA4 purchase exactly once', async () => {
    const o = await seed();
    await pay(o.id, `pesapal:completed:it-${o.id}`);
    await M.routeBusinessEvents();
    const [intent] = await intentsOf(o.id);
    await raw`update measurement.delivery_intent set state = 'ACCEPTED' where delivery_id = ${intent.delivery_id}`;
    await transition.transition(o.id, 'cancelled', { actorType: 'administrator', source: 'admin_api', reasonCode: 'it_cancel', idempotencyKey: `it-cancel-${o.id}` });
    await M.routeBusinessEvents();
    const sinks = (await intentsOf(o.id)).map((i: any) => i.sink_key).sort();
    expect(sinks).toEqual(['ga4:purchase', 'ga4:refund']);
    await transition.transition(o.id, 'cancelled', { actorType: 'administrator', source: 'admin_api', reasonCode: 'it_cancel', idempotencyKey: `it-cancel-${o.id}` });
    await M.routeBusinessEvents();
    expect((await intentsOf(o.id)).length).toBe(2);
  });

  it('a settled refund is ONE refund_confirmed event, a negative ledger entry and a partial GA4 refund', async () => {
    const o = await seed();
    await pay(o.id, `pesapal:completed:it-${o.id}`);
    const [att] = await raw`insert into payment_attempts (order_id, merchant_reference, amount, status, provider)
      values (${o.id}, ${'it-ref-' + o.number}, 95000, 'completed', 'pesapal') returning id`;
    const [ref] = await raw`insert into payment_refunds (payment_attempt_id, order_id, idempotency_key, amount_ugx, reason, status)
      values (${att.id}, ${o.id}, ${'it-refkey-' + o.number}, 30000, 'IT partial', 'requested') returning id`;
    const { DrizzleRefundLedgerRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleRefundLedgerRepository');
    const repo = new DrizzleRefundLedgerRepository();
    await repo.recordProviderOutcome(ref.id, { status: 'settled', providerStatus: 'OK' });
    await repo.recordProviderOutcome(ref.id, { status: 'settled', providerStatus: 'OK' }); // replay
    const refunds = (await eventsOf(o.id)).filter((e: any) => e.event_name === 'refund_confirmed');
    expect(refunds).toHaveLength(1);
    expect(refunds[0].payload.amountUGX).toBe('30000');
    const [entry] = await raw`select * from measurement.commercial_entry where event_id = ${refunds[0].event_id}`;
    expect(Number(entry.amount_ugx)).toBe(-30000);
    expect(entry.component).toBe('REFUND');
    await M.routeBusinessEvents();
    const refundIntents = (await intentsOf(o.id)).filter((i: any) => i.sink_key === 'ga4:refund');
    expect(refundIntents).toHaveLength(1);
  });

  it('replay of a DEAD_LETTER delivery resets the budget and keeps the provider event id', async () => {
    const o = await seed();
    await pay(o.id, `pesapal:completed:it-${o.id}`);
    await M.routeBusinessEvents();
    const [intent] = await intentsOf(o.id);
    await raw`update measurement.delivery_intent set state = 'DEAD_LETTER', attempt_count = 8, state_reason = 'IT' where delivery_id = ${intent.delivery_id}`;
    const { DrizzleMeasurementOperationsRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleMeasurementOperationsRepository');
    const ops = new DrizzleMeasurementOperationsRepository();
    expect(await ops.replay([intent.delivery_id])).toBe(1);
    const [after] = await raw`select * from measurement.delivery_intent where delivery_id = ${intent.delivery_id}`;
    expect(after.state).toBe('RETRY_WAIT');
    expect(Number(after.replay_count)).toBe(1);
    expect(Number(after.attempts_at_replay)).toBe(8);
    expect(after.provider_event_id).toBe(intent.provider_event_id);
    // The replayed delivery is due again and its attempt budget starts from the replay.
    const scheduled: string[] = [];
    await M.scheduleDueDeliveries(async (_jobId: string, d: any) => { scheduled.push(d.deliveryId); return true; });
    expect(scheduled).toContain(intent.delivery_id);
  });

  it('collector v2: a landing touch is stored once and the same batch id answers the same receipt', async () => {
    const { CollectBrowserBatchUseCase } = await import('../../apps/api/src/application/use-cases/telemetry/CollectBrowserBatchUseCase');
    const { DrizzleCollectorStore } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleCollectorStore');
    const uc = new CollectBrowserBatchUseCase(new DrizzleCollectorStore(), async () => {});
    const anon = `it-touch-${Date.now().toString(36)}`;
    const body = JSON.stringify({ batchId: crypto.randomUUID(), schemaVersion: 1, pageInstanceId: 'it-collector', events: [{
      event_name: 'landing_touch', event_id: crypto.randomUUID(), event_time: Math.floor(Date.now() / 1000), source: 'browser',
      user_data: { fp_client_id: anon },
      touch: { source: 'google', medium: 'cpc', campaign: 'c', referrer_host: 'www.google.com', landing_path: '/shop', click_id_types: ['gclid'] } }] });
    const a: any = await uc.execute(body);
    const b: any = await uc.execute(body);
    expect(a.status).toBe(202);
    expect(b.replay).toBe(true);
    expect(b.receipt.receiptId).toBe(a.receipt.receiptId);
    const stored = await raw`select channel from measurement.touchpoint where anonymous_id = ${anon}`;
    expect(stored).toHaveLength(1);
    expect(stored[0].channel).toBe('paid_search');
  });

  it('attribution batch runs under the lease and says INSUFFICIENT_DATA rather than inventing a model', async () => {
    const { runAttributionBatch } = await import('../../apps/api/src/infrastructure/measurement/AttributionJob');
    const r = await runAttributionBatch('integration-test');
    expect(['COMPLETE', 'DEFERRED_RESOURCE']).toContain(r.state);
    if (r.state === 'COMPLETE') {
      const runs = await raw`select method, status from measurement.attribution_run where started_at > now() - interval '5 minutes'`;
      expect(runs.length).toBeGreaterThan(0);
      for (const run of runs) expect(['COMPLETE', 'INSUFFICIENT_DATA', 'NOT_IDENTIFIABLE', 'DATA_INVALID']).toContain(run.status);
      const [lease] = await raw`select lease_until from measurement.analytics_lease where name = 'analytics'`;
      expect(new Date(lease.lease_until).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });

  it('no visitor id: GA4 delivery is SUPPRESSED(IDENTITY_UNAVAILABLE), never sent with an invented visitor', async () => {
    const o = await seed();
    await raw`delete from order_attribution where order_id = ${o.id}`;
    await pay(o.id, `pesapal:completed:it-${o.id}`);
    await M.routeBusinessEvents();
    const [intent] = await intentsOf(o.id);
    await raw`update measurement.delivery_intent set enqueue_generation = 7 where delivery_id = ${intent.delivery_id}`;
    let calls = 0;
    expect(await M.deliverOne(intent.delivery_id, 7, (async () => { calls++; return new Response(null, { status: 204 }); }) as any)).toBe('SUPPRESSED');
    expect(calls).toBe(0);
    expect((await raw`select state_reason from measurement.delivery_intent where delivery_id = ${intent.delivery_id}`)[0].state_reason).toBe('IDENTITY_UNAVAILABLE');
  });
});

