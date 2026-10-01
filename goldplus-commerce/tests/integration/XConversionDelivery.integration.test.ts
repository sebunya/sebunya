import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Fixtures } from './helpers/fixtures';

/**
 * What X receives, counted. This runs the REAL purchase delivery path against
 * PostgreSQL with only the provider's HTTP endpoint stubbed. In the default
 * scope (X clicks only):
 *
 *   - an order that did not come from an X click makes no call;
 *   - an order that did makes exactly one, shaped as X documents it;
 *   - a failing X is retried, and a refusal is not.
 */
const URL_ = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL_ && process.env.DATABASE_URL ? describe : describe.skip;

suite('X conversions: a call is spent only on an X-click purchase (real PostgreSQL)', () => {
  let raw: any;
  let transition: any;
  let M: any;
  let fx: Fixtures;
  let productId: string;
  const orders: string[] = [];
  let previous: any = null;
  const KEYS = { consumerKey: 'ck', consumerSecret: 'cs', accessToken: 'at', accessTokenSecret: 'ats' };

  beforeAll(async () => {
    process.env.MEASUREMENT_ALLOW_NONPROD_DELIVERY = 'true';
    process.env.SEO_CREDENTIAL_VAULT_KEY = 'it-vault-key-for-x-conversion-delivery-test';
    const { createRequire } = await import('node:module');
    const postgres = createRequire(import.meta.url)('postgres');
    raw = postgres(URL_ as string, { max: 2, onnotice: () => undefined });
    const { OrderTransitionService } = await import('../../apps/api/src/infrastructure/orders/OrderTransitionService');
    transition = new OrderTransitionService();
    M = await import('../../apps/api/src/infrastructure/measurement/DeliveryService');
    const { IntegrationCredentialVault } = await import('../../apps/api/src/infrastructure/seo/IntegrationCredentialVault');
    const { DrizzleAdDestinationRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAdDestinationRepository');
    fx = new Fixtures(raw);
    productId = (await fx.product()).id;
    await raw`delete from measurement.control where key = 'kill_switch'`;
    [previous] = await raw`select * from ad_destinations where platform = 'x'`;
    await new DrizzleAdDestinationRepository().save('x', {
      enabled: true,
      // A stale add-to-cart id, as an earlier version of the admin form could have saved.
      config: { pixelId: 'o8z6j', purchaseEventId: 'tw-o8z6j-o8z6k', addToCartEventId: 'tw-o8z6j-o8z6m' },
      secretEnc: IntegrationCredentialVault.fromEnv()!.encrypt({ apiKey: JSON.stringify(KEYS) }),
      secretMask: '••••',
      updatedBy: null,
    });
  });

  afterAll(async () => {
    if (!raw) return;
    if (!previous) await raw`delete from ad_destinations where platform = 'x'`;
    else await raw`update ad_destinations set enabled = ${previous.enabled}, config = ${previous.config}, secret_enc = ${previous.secret_enc}, secret_mask = ${previous.secret_mask} where platform = 'x'`;
    if (orders.length) {
      const evs = (await raw`select event_id from measurement.business_event where aggregate_id = any(${orders})`).map((r: any) => r.event_id);
      if (evs.length) {
        await raw`delete from measurement.delivery_attempt where delivery_id in (select delivery_id from measurement.delivery_intent where event_id = any(${evs}))`;
        await raw`delete from measurement.delivery_intent where event_id = any(${evs})`;
        await raw`delete from measurement.event_routing where event_id = any(${evs})`;
        await raw`delete from measurement.commercial_entry where event_id = any(${evs})`;
        await raw`delete from measurement.business_event where event_id = any(${evs})`;
      }
      await raw`delete from order_attribution where order_id = any(${orders})`;
      await raw`delete from order_events where order_id = any(${orders})`;
      await raw`delete from order_items where order_id = any(${orders})`;
      await raw`delete from orders where id = any(${orders})`;
    }
    await fx?.cleanup();
    await raw.end();
  });

  /** A paid order, routed, with its X delivery due; `clickIds` is what checkout recorded. */
  const paidOrder = async (clickIds: Record<string, string> | null) => {
    const on = `ix${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, customer_email, delivery_area, delivery_address,
      subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method)
      values (${on}, 'IT', '0772123456', 'buyer@example.com', 'Kla', 'Adr', 90000, 5000, 95000, 'received', 'unpaid', 'pesapal') returning id`;
    await raw`insert into order_items (order_id, product_id, sku, product_name, quantity, unit_price, final_line_total, cogs_snapshot_ugx)
      values (${o.id}, ${productId}, 'IX-SKU', 'IX item', 2, 45000, 90000, 55000)`;
    await raw`insert into order_attribution (order_id, order_number, fp_client_id, client_ip, user_agent, click_ids)
      values (${o.id}, ${on}, ${'fp.1700000000000.00000000-0000-4000-8000-' + on.padEnd(12, '0').slice(0, 12)}, '41.84.203.125', 'Mozilla/5.0 IX', ${clickIds ? raw.json(clickIds) : null})`;
    orders.push(o.id);
    await transition.transition(o.id, 'processing', { actorType: 'payment_provider', source: 'payment', reasonCode: 'pesapal_payment_completed', paymentStatus: 'paid', idempotencyKey: `pesapal:completed:ix-${o.id}` });
    await M.routeBusinessEvents();
    const intent = async () => (await raw`select i.* from measurement.delivery_intent i join measurement.business_event e using (event_id)
      where e.aggregate_id = ${o.id} and i.sink_key = 'ad:x:purchase'`)[0];
    const due = async () => {
      await raw`update measurement.delivery_intent set next_attempt_at = now() - interval '1 second', next_enqueue_at = now() - interval '1 second' where delivery_id = ${(await intent()).delivery_id}`;
      await M.scheduleDueDeliveries(async () => true);
      return intent();
    };
    return { id: o.id as string, number: on, intent, due };
  };

  const recorder = (status: number) => {
    const calls: Array<{ url: string; init: any }> = [];
    const fetchImpl = (async (url: string, init: any) => { calls.push({ url: String(url), init }); return new Response(status < 300 ? '{"data":{"conversions_processed":1}}' : '{"errors":[]}', { status }); }) as any;
    return { calls, fetchImpl };
  };

  it('no X click: nothing is sent, however well the buyer could be matched', async () => {
    for (const clicks of [null, { gclid: 'Cj0KCQ' }, { ttclid: 'tt1', src: 'tiktok' }]) {
      const o = await paidOrder(clicks);
      const i = await o.due();
      expect(i, 'an X delivery is planned for every paid order').toBeTruthy();
      const { calls, fetchImpl } = recorder(200);
      expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, fetchImpl)).toBe('SUPPRESSED');
      expect(calls).toHaveLength(0);
      expect(await o.intent()).toMatchObject({ state: 'SUPPRESSED', state_reason: 'NO_X_CLICK', attempt_count: 0 });
      // Terminal: it is never picked up again.
      expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, fetchImpl)).toBe('NOT_CLAIMED');
      expect(calls).toHaveLength(0);
    }
  });

  it('an X click: exactly one signed call, shaped as X documents it, and never a second', async () => {
    const o = await paidOrder({ twclid: '23opevjt88psuo13lu8d020qkn', src: 'x' });
    const i = await o.due();
    const { calls, fetchImpl } = recorder(200);
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, fetchImpl)).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://ads-api.x.com/12/measurement/conversions/o8z6j');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toMatch(/^OAuth oauth_consumer_key="ck", .*oauth_token="at", .*oauth_signature="[^"]+"$/);
    const body = JSON.parse(calls[0].init.body);
    expect(body.conversions).toHaveLength(1);
    const c = body.conversions[0];
    expect(c.event_id).toBe('tw-o8z6j-o8z6k');
    expect(c.value).toBe('95000');
    expect(c.price_currency).toBe('UGX');
    expect(c.number_items).toBe(2);
    expect(c.contents).toEqual([{ content_id: productId, content_name: 'IX item', content_price: 45000, num_items: 2 }]);
    expect(c.identifiers[0]).toEqual({ twclid: '23opevjt88psuo13lu8d020qkn' });
    expect(c.identifiers).toContainEqual({ ip_address: '41.84.203.125', user_agent: 'Mozilla/5.0 IX' });
    expect(c.identifiers.some((x: any) => /^[0-9a-f]{64}$/.test(x.hashed_email ?? ''))).toBe(true);
    expect(c.identifiers.some((x: any) => /^[0-9a-f]{64}$/.test(x.hashed_phone_number ?? ''))).toBe(true);
    // Nothing readable about the buyer leaves the building.
    expect(calls[0].init.body).not.toMatch(/buyer@example\.com|0772123456|256772123456/);
    expect(await o.intent()).toMatchObject({ state: 'ACCEPTED', attempt_count: 1 });
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, fetchImpl)).toBe('NOT_CLAIMED');
    expect(calls).toHaveLength(1);
  });

  it('X failing: the delivery waits and is retried, and the retry succeeds', async () => {
    const o = await paidOrder({ twclid: 'tw-click-2', src: 'x' });
    const down = recorder(503);
    let i = await o.due();
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, down.fetchImpl)).toBe('RETRY_WAIT');
    i = await o.due();
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, down.fetchImpl)).toBe('RETRY_WAIT');
    const up = recorder(200);
    i = await o.due();
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, up.fetchImpl)).toBe('ACCEPTED');
    expect(down.calls).toHaveLength(2);
    expect(up.calls).toHaveLength(1);
    // The same conversion id on every attempt, so X counts the sale once.
    const ids = [...down.calls, ...up.calls].map((c) => JSON.parse(c.init.body).conversions[0].conversion_id);
    expect(new Set(ids).size).toBe(1);
  });

  it('scope "all": an order with no X click is sent, matched by hashed contact', async () => {
    await raw`update ad_destinations set config = config || '{"sendScope":"all"}'::jsonb where platform = 'x'`;
    try {
      const o = await paidOrder(null);
      const i = await o.due();
      const { calls, fetchImpl } = recorder(200);
      expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, fetchImpl)).toBe('ACCEPTED');
      expect(calls).toHaveLength(1);
      const ids = JSON.parse(calls[0].init.body).conversions[0].identifiers;
      expect(ids.some((x: any) => 'twclid' in x)).toBe(false);
      expect(ids.some((x: any) => /^[0-9a-f]{64}$/.test(x.hashed_email ?? ''))).toBe(true);
    } finally {
      await raw`update ad_destinations set config = config - 'sendScope' where platform = 'x'`;
    }
  });

  // The visitor carries no X click id: under the default scope X is skipped
  // without a call, while a platform that matches on contact still gets it.
  it('basket events, default scope: not sent to X without an X click id; another live platform still gets them', async () => {
    const { fanOutAdConversions, processAdConversionBatch } = await import('../../apps/api/src/infrastructure/advertising/AdConversionDispatch');
    const { IntegrationCredentialVault } = await import('../../apps/api/src/infrastructure/seo/IntegrationCredentialVault');
    const { DrizzleAdDestinationRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAdDestinationRepository');
    const { randomUUID } = await import('node:crypto');
    // A second platform that DOES take basket events, so the queue itself is exercised:
    // its insert used to fail for every platform (a platform key in a uuid column).
    const [metaBefore] = await raw`select * from ad_destinations where platform = 'meta'`;
    await new DrizzleAdDestinationRepository().save('meta', {
      enabled: true, config: { datasetId: '1234567890123' },
      secretEnc: IntegrationCredentialVault.fromEnv()!.encrypt({ apiKey: 'EAAB' + 'x'.repeat(40) }), secretMask: '••••', updatedBy: null,
    });
    const event = { event_name: 'add_to_cart', event_id: randomUUID(), event_time: Math.floor(Date.now() / 1000), source: 'server',
      page_location: 'https://shopgoldplus.com/products/ix',
      user_data: { fp_client_id: 'fp.1.ix-b', hashed_email: 'a'.repeat(64) },
      ecommerce: { value: 45000, currency: 'UGX', items: [{ item_id: productId, item_name: 'IX item', price: 45000, quantity: 1 }] } } as never;
    const hosts: string[] = [];
    const realFetch = globalThis.fetch;
    try {
      // Each process caches the live platform list for a minute; this test's process has not read it yet.
      // Both platforms map the event, so both get a queue row (the insert that used to fail).
      expect(await fanOutAdConversions(event)).toBe(2);

      globalThis.fetch = (async (url: string) => { hosts.push(new URL(String(url)).hostname); return new Response('{"events_received":1}', { status: 200 }); }) as never;
      // Under vitest a Date bound as a query parameter loses its milliseconds
      // (it crosses a realm boundary and is sent as its string form), so a row
      // queued in this same second would not look due yet. Production is not
      // affected; the dispatcher runs on a timer long after the row is queued.
      await new Promise((r) => setTimeout(r, 1100));
      const outcome = await processAdConversionBatch();
      // Meta's goes out; X's is skipped without a call.
      expect(outcome).toMatchObject({ claimed: 2, sent: 1, skipped: 1 });
      // And the row says which of the three reasons it was, so the activity page need not guess.
      const [xRow] = await raw`select status, last_error from outbox_events where idempotency_key = ${'ad:x:' + (event as any).event_id}`;
      expect(xRow).toMatchObject({ status: 'skipped', last_error: 'NO_X_CLICK' });
    } finally {
      globalThis.fetch = realFetch;
      await raw`delete from outbox_events where idempotency_key like ${'ad:%:' + (event as any).event_id}`;
      if (!metaBefore) await raw`delete from ad_destinations where platform = 'meta'`;
      else await raw`update ad_destinations set enabled = ${metaBefore.enabled}, config = ${metaBefore.config}, secret_enc = ${metaBefore.secret_enc}, secret_mask = ${metaBefore.secret_mask} where platform = 'meta'`;
    }
    expect(hosts.filter((h) => /(^|\.)x\.com$|twitter\.com$/.test(h))).toEqual([]);
    expect(hosts).toEqual(['graph.facebook.com']);
  }, 30_000);

  // X has no Events Manager ID saved for a product view in this configuration,
  // so nothing could ever be sent for one: it is not queued for X at all.
  it('an event X has no event ID for is never queued for X', async () => {
    const { fanOutAdConversions } = await import('../../apps/api/src/infrastructure/advertising/AdConversionDispatch');
    const { randomUUID } = await import('node:crypto');
    const event = { event_name: 'view_item', event_id: randomUUID(), event_time: Math.floor(Date.now() / 1000), source: 'server',
      user_data: { fp_client_id: 'fp.1.ix-view', twclid: 'tw-click-view' },
      ecommerce: { value: 45000, currency: 'UGX', items: [{ item_id: productId, item_name: 'IX item', price: 45000, quantity: 1 }] } } as never;
    try {
      await fanOutAdConversions(event);
      expect(await raw`select 1 from outbox_events where idempotency_key = ${'ad:x:' + (event as any).event_id}`).toHaveLength(0);
    } finally {
      await raw`delete from outbox_events where idempotency_key like ${'ad:%:' + (event as any).event_id}`;
    }
  }, 30_000);

  // Same basket add, but the visitor arrived on an X ad. As in production, the
  // event itself names only the visitor (fp_client_id, IP, UA): the click id
  // was stitched into the identity graph by /telemetry/identity. Under the
  // default scope the add now goes to X, under the add-to-cart event id
  // (2026-10-01: optimisation events for X-click visitors, not purchases only).
  it('basket events, default scope: sent to X under the add-to-cart event id when the identity graph holds the visitor\'s X click id', async () => {
    const { fanOutAdConversions, processAdConversionBatch } = await import('../../apps/api/src/infrastructure/advertising/AdConversionDispatch');
    const { randomUUID } = await import('node:crypto');
    const fp = `fp.1.ix-c-${randomUUID().slice(0, 8)}`;
    await raw`insert into first_party_identities (fp_client_id, twclid) values (${fp}, 'tw-click-basket')`;
    const event = { event_name: 'add_to_cart', event_id: randomUUID(), event_time: Math.floor(Date.now() / 1000), source: 'server',
      page_location: 'https://shopgoldplus.com/products/ix',
      user_data: { fp_client_id: fp, ip_address: '41.84.203.125', user_agent: 'UA' },
      ecommerce: { value: 45000, currency: 'UGX', items: [{ item_id: productId, item_name: 'IX item', price: 45000, quantity: 1 }] } } as never;
    const sent: Array<{ url: string; body: any; auth: string }> = [];
    const realFetch = globalThis.fetch;
    try {
      expect(await fanOutAdConversions(event)).toBeGreaterThanOrEqual(1);
      // The queued row is exactly the event as received: no click id is persisted.
      const [queued] = await raw`select payload from outbox_events where idempotency_key = ${'ad:x:' + (event as any).event_id}`;
      const queuedPayload = typeof queued.payload === 'string' ? JSON.parse(queued.payload) : queued.payload;
      expect(queuedPayload.event.user_data.twclid).toBeUndefined();
      globalThis.fetch = (async (url: string, init: any) => {
        sent.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization ?? '' });
        return new Response('{"conversion_events_received":1}', { status: 200 });
      }) as never;
      await new Promise((r) => setTimeout(r, 1100));
      await processAdConversionBatch();
    } finally {
      globalThis.fetch = realFetch;
      await raw`delete from outbox_events where idempotency_key like ${'ad:%:' + (event as any).event_id}`;
      await raw`delete from first_party_identities where fp_client_id = ${fp}`;
    }
    const x = sent.filter((s) => /ads-api\.x\.com/.test(s.url));
    expect(x).toHaveLength(1);
    expect(x[0].url).toBe('https://ads-api.x.com/12/measurement/conversions/o8z6j');
    expect(x[0].auth).toMatch(/^OAuth oauth_consumer_key="ck", /);
    const c = x[0].body.conversions[0];
    expect(c.event_id).toBe('tw-o8z6j-o8z6m');
    expect(c.identifiers.some((i: any) => i.twclid === 'tw-click-basket')).toBe(true);
    expect(c.value).toBe('45000');
  }, 30_000);

  it('X refusing the request (4xx): one call, no retry', async () => {
    const o = await paidOrder({ twclid: 'tw-click-3', src: 'x' });
    const { calls, fetchImpl } = recorder(403);
    const i = await o.due();
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, fetchImpl)).toBe('DEAD_LETTER');
    expect(calls).toHaveLength(1);
  });
});
