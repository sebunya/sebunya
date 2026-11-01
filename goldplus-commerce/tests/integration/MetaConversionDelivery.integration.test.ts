import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Fixtures } from './helpers/fixtures';

/**
 * What Meta receives, end to end, against real PostgreSQL with only Meta's
 * HTTP endpoint stubbed. The shop runs no Meta Pixel, so every match key has
 * to come from our own records:
 *
 *   - a purchase carries the click id the browser built from the landing
 *     URL's fbclid, a browser id derived from the visitor id, the hashed
 *     contact, and the name, district and country the order itself states;
 *   - a browsing event names only the visitor, and gets its click id from the
 *     identity graph at send time (never stored on the queued row);
 *   - Meta's own account of a refusal is kept, a revoked token is a
 *     credentials problem, and a rate limit is retried rather than buried;
 *   - the identity graph keeps the LAST click, and when it changed.
 */
const URL_ = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL_ && process.env.DATABASE_URL ? describe : describe.skip;
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

suite('Meta conversions: full match keys from our own records (real PostgreSQL)', () => {
  let raw: any;
  let transition: any;
  let M: any;
  let fx: Fixtures;
  let productId: string;
  const orders: string[] = [];
  const visitors: string[] = [];
  let previous: any = null;
  const DATASET = '1234567890123456';
  const TOKEN = 'EAAB' + 'x'.repeat(60);
  const ENDPOINT = `https://graph.facebook.com/v25.0/${DATASET}/events`;
  let priorOrigin: string | undefined;

  beforeAll(async () => {
    process.env.MEASUREMENT_ALLOW_NONPROD_DELIVERY = 'true';
    process.env.SEO_CREDENTIAL_VAULT_KEY = 'it-vault-key-for-meta-conversion-delivery-test';
    priorOrigin = process.env.PUBLIC_SITE_ORIGIN;
    process.env.PUBLIC_SITE_ORIGIN = 'https://shopgoldplus.com';
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
    [previous] = await raw`select * from ad_destinations where platform = 'meta'`;
    await new DrizzleAdDestinationRepository().save('meta', {
      enabled: true, config: { datasetId: DATASET },
      secretEnc: IntegrationCredentialVault.fromEnv()!.encrypt({ apiKey: TOKEN }), secretMask: '••••', updatedBy: null,
    });
  }, 60_000);

  afterAll(async () => {
    if (priorOrigin === undefined) delete process.env.PUBLIC_SITE_ORIGIN; else process.env.PUBLIC_SITE_ORIGIN = priorOrigin;
    if (!raw) return;
    if (!previous) await raw`delete from ad_destinations where platform = 'meta'`;
    else await raw`update ad_destinations set enabled = ${previous.enabled}, config = ${previous.config}, secret_enc = ${previous.secret_enc}, secret_mask = ${previous.secret_mask}, last_error = ${previous.last_error} where platform = 'meta'`;
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
    if (visitors.length) await raw`delete from first_party_identities where fp_client_id = any(${visitors})`;
    await fx?.cleanup();
    await raw.end();
  });

  const visitorId = () => { const fp = `fp.1790841536221.${randomUUID()}`; visitors.push(fp); return fp; };

  /** A paid order, routed, with its Meta delivery due. */
  const paidOrder = async (o: { clickIds?: Record<string, string> | null; name?: string; district?: string | null; fp?: string }) => {
    const on = `im${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const fp = o.fp ?? visitorId();
    const [row] = await raw`insert into orders (order_number, customer_name, customer_phone, customer_email, delivery_area, delivery_address, delivery_location,
      subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method)
      values (${on}, ${o.name ?? 'Sarah Nakato'}, '0772123456', ' Buyer@Example.com ', 'Kira', 'Adr', ${o.district === null ? null : raw.json({ district: o.district ?? 'Wakiso', displayLabel: 'Kira, Wakiso' })},
      90000, 5000, 95000, 'received', 'unpaid', 'pesapal') returning id`;
    await raw`insert into order_items (order_id, product_id, sku, product_name, quantity, unit_price, final_line_total, cogs_snapshot_ugx)
      values (${row.id}, ${productId}, 'IM-SKU', 'IM item', 2, 45000, 90000, 55000)`;
    await raw`insert into order_attribution (order_id, order_number, fp_client_id, client_ip, user_agent, click_ids)
      values (${row.id}, ${on}, ${fp}, '41.84.203.125', 'Mozilla/5.0 IM', ${o.clickIds ? raw.json(o.clickIds) : null})`;
    orders.push(row.id);
    await transition.transition(row.id, 'processing', { actorType: 'payment_provider', source: 'payment', reasonCode: 'pesapal_payment_completed', paymentStatus: 'paid', idempotencyKey: `pesapal:completed:im-${row.id}` });
    await M.routeBusinessEvents();
    const intent = async () => (await raw`select i.* from measurement.delivery_intent i join measurement.business_event e using (event_id)
      where e.aggregate_id = ${row.id} and i.sink_key = 'ad:meta:purchase'`)[0];
    const due = async () => {
      await raw`update measurement.delivery_intent set next_attempt_at = now() - interval '1 second', next_enqueue_at = now() - interval '1 second' where delivery_id = ${(await intent()).delivery_id}`;
      await M.scheduleDueDeliveries(async () => true);
      return intent();
    };
    return { id: row.id as string, number: on, fp, intent, due };
  };

  const recorder = (answer: { status: number; body: unknown }) => {
    const calls: Array<{ url: string; init: any }> = [];
    const fetchImpl = (async (url: string, init: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(answer.body), { status: answer.status }); }) as any;
    return { calls, fetchImpl };
  };
  const OK = { status: 200, body: { events_received: 1, messages: [], fbtrace_id: 'ok1' } };

  it('a purchase from a Meta ad click: one call, every match key in Meta\'s form, the page it happened on, and the order', async () => {
    const fbc = 'fb.1.1790841539999.IwAR2xQzAbC_dEf-GhIjKlMnOpQrStUv';
    const o = await paidOrder({ clickIds: { fbc, src: 'facebook' } });
    const i = await o.due();
    const { calls, fetchImpl } = recorder(OK);
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, fetchImpl)).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(ENDPOINT);
    expect(calls[0].url).not.toContain(TOKEN);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(calls[0].init.body);
    expect(body.test_event_code).toBeUndefined();
    expect(body.data).toHaveLength(1);
    const ev = body.data[0];
    expect([ev.event_name, ev.action_source, ev.event_source_url]).toEqual(['Purchase', 'website', 'https://shopgoldplus.com/checkout']);
    expect(ev.data_processing_options).toEqual([]);
    expect(ev.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ev.user_data).toEqual({
      em: [sha('buyer@example.com')], ph: [sha('256772123456')],
      fn: [sha('sarah')], ln: [sha('nakato')], ct: [sha('wakiso')], country: [sha('ug')],
      external_id: [sha(o.fp)],
      fbc,                                                              // exactly as the browser built it
      fbp: expect.stringMatching(/^fb\.1\.1790841536221\.[1-9]\d{9}$/),  // derived from the visitor id: no Pixel, no cookie
      client_ip_address: '41.84.203.125', client_user_agent: 'Mozilla/5.0 IM',
    });
    expect(ev.custom_data).toEqual({ currency: 'UGX', value: 95000, content_type: 'product', content_ids: [productId],
      contents: [{ id: productId, quantity: 2, item_price: 45000 }], content_name: 'IM item', num_items: 2, order_id: o.number });
    expect((await o.intent()).state).toBe('ACCEPTED');
  });

  it('an order with no Meta click, a one-word name and no district still goes — with exactly what it has, and nothing invented', async () => {
    const o = await paidOrder({ clickIds: { gclid: 'Cj0KCQ', src: 'google' }, name: 'Okello', district: null });
    const i = await o.due();
    const { calls, fetchImpl } = recorder(OK);
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, fetchImpl)).toBe('ACCEPTED');
    const ud = JSON.parse(calls[0].init.body).data[0].user_data;
    expect(ud.fbc).toBeUndefined();                                     // another network's click is not Meta's
    expect(ud.fn).toEqual([sha('okello')]);
    expect(ud.ln).toBeUndefined();                                      // half a name is not guessed into a family name
    expect(ud.ct).toBeUndefined();
    expect(ud.country).toEqual([sha('ug')]);
    expect(ud.fbp).toMatch(/^fb\.1\.\d{13}\.\d{10}$/);
  });

  it('a buyer abroad ordering for delivery in Uganda is not labelled Ugandan, nor placed in the recipient\'s district', async () => {
    const o = await paidOrder({ clickIds: null });
    await raw`update orders set customer_phone = '+44 7700 900123' where id = ${o.id}`;
    const i = await o.due();
    const { calls, fetchImpl } = recorder(OK);
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, fetchImpl)).toBe('ACCEPTED');
    const ud = JSON.parse(calls[0].init.body).data[0].user_data;
    expect(ud.country).toBeUndefined();
    expect(ud.ct).toBeUndefined();
    expect(ud.fn).toEqual([sha('sarah')]);                              // the name is the buyer's wherever they are
    expect(ud.ph).toEqual([sha('447700900123')]);
    expect(M.buyerIsInUganda('0772 123 456')).toBe(true);
    expect(M.buyerIsInUganda('+256772123456')).toBe(true);
    for (const abroad of ['+44 7700 900123', '+1 650 555 1212', '', null]) expect(M.buyerIsInUganda(abroad), String(abroad)).toBe(false);
  });

  it('a click id of the wrong shape on the order is not passed to Meta as one', async () => {
    const o = await paidOrder({ clickIds: { fbc: 'IwAR-a-raw-fbclid-not-in-metas-format' } });
    // The repository that records an order's click ids refuses it too.
    const { DrizzleOrderAttributionRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleOrderAttributionRepository');
    const [second] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method)
      values (${'imx' + Date.now().toString(36)}, 'IT', '0772123456', 'Kla', 'Adr', 1000, 0, 1000, 'received', 'unpaid', 'pesapal') returning id`;
    orders.push(second.id);
    await new DrizzleOrderAttributionRepository().record({ orderId: second.id, clickIds: { fbc: 'not-a-click-id', twclid: 'tw-ok', src: 'x' } });
    const [stored] = await raw`select click_ids from order_attribution where order_id = ${second.id}`;
    expect(typeof stored.click_ids === 'string' ? JSON.parse(stored.click_ids) : stored.click_ids).toEqual({ twclid: 'tw-ok', src: 'x' });
    const i = await o.due();
    const { calls, fetchImpl } = recorder(OK);
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, fetchImpl)).toBe('ACCEPTED');
    expect(JSON.parse(calls[0].init.body).data[0].user_data.fbc).toBeUndefined();
  });

  it('a revoked token is a credentials problem, final, and Meta\'s own words are kept for the owner', async () => {
    const o = await paidOrder({ clickIds: null });
    const i = await o.due();
    const refused = recorder({ status: 400, body: { error: { message: 'Error validating access token: The session has been invalidated', type: 'OAuthException', code: 190, error_subcode: 460, fbtrace_id: 'AbCdEf123' } } });
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, refused.fetchImpl)).toBe('DEAD_LETTER');
    const after = await o.intent();
    expect(after.state).toBe('DEAD_LETTER');
    expect(after.state_reason).toBe('CREDENTIALS: Meta error 190/460: Error validating access token: The session has been invalidated (fbtrace_id AbCdEf123)');
    expect(after.state_reason).not.toContain(TOKEN);
    const [dest] = await raw`select last_error from ad_destinations where platform = 'meta'`;
    expect(dest.last_error).toContain('Meta error 190/460');
    const [attempt] = await raw`select outcome, http_status, provider_code from measurement.delivery_attempt where delivery_id = ${after.delivery_id} order by attempt_no desc limit 1`;
    expect(attempt).toMatchObject({ outcome: 'PERMANENT', http_status: 400 });
    expect(attempt.provider_code).toContain('Meta error 190/460');
  });

  it('a rate limit arrives as HTTP 400: it is retried, and the same event id goes again so Meta counts the sale once', async () => {
    const o = await paidOrder({ clickIds: null });
    let i = await o.due();
    const limited = recorder({ status: 400, body: { error: { message: '(#17) User request limit reached', type: 'OAuthException', code: 17, fbtrace_id: 'Lim1' } } });
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, limited.fetchImpl)).toBe('RETRY_WAIT');
    const waiting = await o.intent();
    expect(waiting.state).toBe('RETRY_WAIT');
    expect(waiting.state_reason).toBe('PROVIDER_TRANSIENT: Meta error 17: (#17) User request limit reached (fbtrace_id Lim1)');
    i = await o.due();
    const up = recorder(OK);
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, up.fetchImpl)).toBe('ACCEPTED');
    const ids = [...limited.calls, ...up.calls].map((c) => JSON.parse(c.init.body).data[0].event_id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
  });

  it('a browsing event names only the visitor: its Meta click id comes from the identity graph at send time and is never stored on the row', async () => {
    const { fanOutAdConversions, processAdConversionBatch } = await import('../../apps/api/src/infrastructure/advertising/AdConversionDispatch');
    const fp = visitorId();
    const fbc = 'fb.1.1790841538888.IwAR_browse_click_ABCdef12345';
    await raw`insert into first_party_identities (fp_client_id, fbc, click_ids_at) values (${fp}, ${fbc}, now())`;
    const event = { event_name: 'add_to_cart', event_id: randomUUID(), event_time: Math.floor(Date.now() / 1000), source: 'server',
      page_location: 'https://shopgoldplus.com/products/im',
      user_data: { fp_client_id: fp, ip_address: '41.84.203.125', user_agent: 'UA' },
      ecommerce: { value: 45000, currency: 'UGX', items: [{ item_id: productId, item_name: 'IM item', price: 45000, quantity: 1 }] } } as never;
    const sent: Array<{ url: string; body: any }> = [];
    const realFetch = globalThis.fetch;
    try {
      expect(await fanOutAdConversions(event)).toBeGreaterThanOrEqual(1);
      const [queued] = await raw`select payload from outbox_events where idempotency_key = ${'ad:meta:' + (event as any).event_id}`;
      const q = typeof queued.payload === 'string' ? JSON.parse(queued.payload) : queued.payload;
      expect(Object.keys(q.event.user_data).sort()).toEqual(['fp_client_id', 'ip_address', 'user_agent']);
      globalThis.fetch = (async (url: string, init: any) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify(OK.body), { status: 200 }); }) as never;
      await new Promise((r) => setTimeout(r, 1100));
      await processAdConversionBatch();
    } finally {
      globalThis.fetch = realFetch;
      await raw`delete from outbox_events where idempotency_key like ${'ad:%:' + (event as any).event_id}`;
    }
    const meta = sent.filter((s) => s.url === ENDPOINT);
    expect(meta).toHaveLength(1);
    const ev = meta[0].body.data[0];
    expect(ev.event_name).toBe('AddToCart');
    expect(ev.event_source_url).toBe('https://shopgoldplus.com/products/im');
    expect(ev.user_data).toEqual({ external_id: [sha(fp)], fbc, fbp: expect.stringMatching(/^fb\.1\.1790841536221\.[1-9]\d{9}$/), client_ip_address: '41.84.203.125', client_user_agent: 'UA' });
    expect(ev.custom_data).toEqual({ currency: 'UGX', value: 45000, content_type: 'product', content_ids: [productId], contents: [{ id: productId, quantity: 1, item_price: 45000 }], content_name: 'IM item', num_items: 1 });
  }, 30_000);

  it('a search, a new account and a directions tap reach Meta as Search, CompleteRegistration and FindLocation; a search with no browser on record is not sent', async () => {
    const { fanOutAdConversions, processAdConversionBatch } = await import('../../apps/api/src/infrastructure/advertising/AdConversionDispatch');
    const fp = visitorId();
    const mk = (name: string, extra: Record<string, unknown> = {}) => ({ event_name: name, event_id: randomUUID(), event_time: Math.floor(Date.now() / 1000), source: 'browser',
      page_location: 'https://shopgoldplus.com/shop?search=power+bank', user_data: { fp_client_id: fp, ip_address: '41.84.203.125', user_agent: 'UA' }, ...extra });
    const events = [mk('search', { search_term: 'power bank' }), mk('sign_up'), mk('find_location'), mk('page_seen')];
    const blind = mk('search', { search_term: 'cable', user_data: { fp_client_id: fp, ip_address: '41.84.203.125' } });
    const all = [...events, blind];
    const sent: Array<{ url: string; body: any }> = [];
    const realFetch = globalThis.fetch;
    let blindRow: any;
    try {
      for (const e of all) expect(await fanOutAdConversions(e as never)).toBeGreaterThanOrEqual(1);
      globalThis.fetch = (async (url: string, init: any) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify(OK.body), { status: 200 }); }) as never;
      await new Promise((r) => setTimeout(r, 1100));
      await processAdConversionBatch();
      [blindRow] = await raw`select status, last_error from outbox_events where idempotency_key = ${'ad:meta:' + blind.event_id}`;
    } finally {
      globalThis.fetch = realFetch;
      for (const e of all) await raw`delete from outbox_events where idempotency_key like ${'ad:%:' + e.event_id}`;
    }
    const byId = new Map(sent.filter((s) => s.url === ENDPOINT).map((s) => [s.body.data[0].event_id, s.body.data[0]]));
    expect([...byId.keys()].sort()).toEqual(events.map((e) => e.event_id).sort());
    const [search, signUp, directions, pageView] = events.map((e) => byId.get(e.event_id));
    // Every storefront page: what Meta's site-visitor and page-address audiences are built from.
    expect(pageView).toMatchObject({ event_name: 'PageView', action_source: 'website', event_source_url: 'https://shopgoldplus.com/shop?search=power+bank' });
    expect(pageView).not.toHaveProperty('custom_data');
    expect(search).toMatchObject({ event_name: 'Search', action_source: 'website', event_source_url: 'https://shopgoldplus.com/shop?search=power+bank', custom_data: { search_string: 'power bank' } });
    expect(search.user_data).toEqual({ external_id: [sha(fp)], fbp: expect.stringMatching(/^fb\.1\.\d{13}\.[1-9]\d{9}$/), client_ip_address: '41.84.203.125', client_user_agent: 'UA' });
    expect(signUp.event_name).toBe('CompleteRegistration');
    expect(directions.event_name).toBe('FindLocation');
    for (const e of [signUp, directions]) expect(e).not.toHaveProperty('custom_data');
    // Meta refuses a website event with no user agent: this one was never sent, and the row says why.
    expect(blindRow).toMatchObject({ status: 'skipped', last_error: 'NO_BROWSER' });
  }, 30_000);

  it('a signed-in customer\'s browsing event carries their hashed email and phone to Meta, never onto the queued row; an account that refused advertising is not sent', async () => {
    const { fanOutAdConversions, processAdConversionBatch } = await import('../../apps/api/src/infrastructure/advertising/AdConversionDispatch');
    const mkUser = async (phone: string) => { const id = await fx.user(); await raw`update users set phone = ${phone} where id = ${id}`; const [u] = await raw`select email from users where id = ${id}`; return { id, email: String(u.email), phone }; };
    const signedIn = await mkUser('0772 440 011');
    const refusedUser = await mkUser('0772 440 012');
    const fpIn = visitorId(), fpRefused = visitorId(), fpAnon = visitorId();
    await raw`insert into first_party_identities (fp_client_id, user_id) values (${fpIn}, ${signedIn.id}), (${fpRefused}, ${refusedUser.id})`;
    // The ACCOUNT refused advertising; this browser has no choice of its own on record.
    await raw`insert into consent_current_state (user_id, advertising_granted, last_grant_type) values (${refusedUser.id}, false, 'explicit')`;
    const mk = (fp: string) => ({ event_name: 'view_item', event_id: randomUUID(), event_time: Math.floor(Date.now() / 1000), source: 'browser',
      page_location: 'https://shopgoldplus.com/products/im', user_data: { fp_client_id: fp, ip_address: '41.84.203.125', user_agent: 'UA' },
      ecommerce: { value: 45000, currency: 'UGX', items: [{ item_id: productId, price: 45000, quantity: 1 }] } });
    const [eIn, eRefused, eAnon] = [mk(fpIn), mk(fpRefused), mk(fpAnon)];
    const all = [eIn, eRefused, eAnon];
    const sent: Array<{ url: string; body: any }> = [];
    const realFetch = globalThis.fetch;
    let refusedRow: any, queuedText = '';
    try {
      for (const e of all) expect(await fanOutAdConversions(e as never)).toBeGreaterThanOrEqual(1);
      queuedText = JSON.stringify((await raw`select payload from outbox_events where idempotency_key = ${'ad:meta:' + eIn.event_id}`)[0].payload);
      globalThis.fetch = (async (url: string, init: any) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify(OK.body), { status: 200 }); }) as never;
      await new Promise((r) => setTimeout(r, 1100));
      await processAdConversionBatch();
      [refusedRow] = await raw`select status, last_error from outbox_events where idempotency_key = ${'ad:meta:' + eRefused.event_id}`;
    } finally {
      globalThis.fetch = realFetch;
      for (const e of all) await raw`delete from outbox_events where idempotency_key like ${'ad:%:' + e.event_id}`;
      await raw`delete from consent_current_state where user_id = ${refusedUser.id}`;
      await raw`delete from first_party_identities where fp_client_id = any(${[fpIn, fpRefused]})`;
    }
    const byId = new Map(sent.filter((s) => s.url === ENDPOINT).map((s) => [s.body.data[0].event_id, s.body.data[0]]));
    // Hashed as Meta specifies: email trimmed and lower-cased, phone as E.164 digits.
    expect(byId.get(eIn.event_id).user_data).toMatchObject({ em: [sha(signedIn.email.trim().toLowerCase())], ph: [sha('256772440011')], external_id: [sha(fpIn)] });
    // Read at send time: nothing about the customer was written to the queue.
    expect(queuedText).not.toContain(sha(signedIn.email.trim().toLowerCase()));
    expect(queuedText).not.toContain(signedIn.id);
    // A visitor who is not signed in is sent as before, with no contact.
    expect(byId.get(eAnon.event_id).user_data.em).toBeUndefined();
    expect(byId.get(eAnon.event_id).user_data.ph).toBeUndefined();
    // The account's refusal stops the event although the event itself names no account.
    expect(byId.has(eRefused.event_id)).toBe(false);
    expect(refusedRow).toMatchObject({ status: 'suppressed', last_error: 'CONSENT_DENIED' });
  }, 30_000);

  it('a quote request sent without signing in: its Lead reaches Meta with the contact the request gave, read at send time', async () => {
    const { fanOutAdConversions, processAdConversionBatch } = await import('../../apps/api/src/infrastructure/advertising/AdConversionDispatch');
    const ref = `BQ-${randomUUID().slice(0, 8).toUpperCase()}`, oldRef = `BQ-${randomUUID().slice(0, 8).toUpperCase()}`;
    const email = `quote-${randomUUID().slice(0, 8)}@example.test`;
    await raw`insert into quote_requests (customer_name, email, phone, product_name, quantity, reference) values ('Quote Buyer', ${email}, '0772 440 021', 'Power bank', '20', ${ref})`;
    await raw`insert into quote_requests (customer_name, email, phone, product_name, quantity, reference, created_at) values ('Old Buyer', ${`old-${email}`}, '0772 440 022', 'Cable', '5', ${oldRef}, now() - interval '3 hours')`;
    const mk = (r: string) => ({ event_name: 'generate_lead', event_id: randomUUID(), event_time: Math.floor(Date.now() / 1000), source: 'browser', lead: { method: 'quote_request', ref: r },
      page_location: 'https://shopgoldplus.com/bulk/submitted', user_data: { fp_client_id: visitorId(), ip_address: '41.84.203.125', user_agent: 'UA' } });
    const fresh = mk(ref), stale = mk(oldRef);
    const sent: Array<{ url: string; body: any }> = [];
    const realFetch = globalThis.fetch;
    let queuedText = '';
    try {
      for (const e of [fresh, stale]) expect(await fanOutAdConversions(e as never)).toBeGreaterThanOrEqual(1);
      queuedText = JSON.stringify((await raw`select payload from outbox_events where idempotency_key = ${'ad:meta:' + fresh.event_id}`)[0].payload);
      globalThis.fetch = (async (url: string, init: any) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify(OK.body), { status: 200 }); }) as never;
      await new Promise((r) => setTimeout(r, 1100));
      await processAdConversionBatch();
    } finally {
      globalThis.fetch = realFetch;
      for (const e of [fresh, stale]) await raw`delete from outbox_events where idempotency_key like ${'ad:%:' + e.event_id}`;
      await raw`delete from quote_requests where reference = any(${[ref, oldRef]})`;
    }
    const byId = new Map(sent.filter((s) => s.url === ENDPOINT).map((s) => [s.body.data[0].event_id, s.body.data[0]]));
    expect(byId.get(fresh.event_id)).toMatchObject({ event_name: 'Lead', user_data: { em: [sha(email)], ph: [sha('256772440021')] } });
    // The queue holds the reference, never the contact.
    expect(queuedText).toContain(ref);
    expect(queuedText).not.toContain(sha(email));
    // A reference from a request made hours ago brings no contact with it: the Lead still goes, on the visitor alone.
    expect(byId.get(stale.event_id).event_name).toBe('Lead');
    expect(byId.get(stale.event_id).user_data.em).toBeUndefined();
    expect(byId.get(stale.event_id).user_data.ph).toBeUndefined();
  }, 30_000);

  it('a browsing event Meta rate-limits is kept for a retry, with Meta\'s message, not dead-lettered', async () => {
    const { fanOutAdConversions, processAdConversionBatch } = await import('../../apps/api/src/infrastructure/advertising/AdConversionDispatch');
    const event = { event_name: 'view_item', event_id: randomUUID(), event_time: Math.floor(Date.now() / 1000), source: 'server',
      page_location: 'https://shopgoldplus.com/products/im', user_data: { fp_client_id: visitorId(), ip_address: '41.84.203.125', user_agent: 'UA' },
      ecommerce: { value: 45000, currency: 'UGX', items: [{ item_id: productId, price: 45000, quantity: 1 }] } } as never;
    const realFetch = globalThis.fetch;
    try {
      await fanOutAdConversions(event);
      globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: '(#4) Application request limit reached', code: 4, fbtrace_id: 'Lim4' } }), { status: 400 })) as never;
      await new Promise((r) => setTimeout(r, 1100));
      await processAdConversionBatch();
      const [row] = await raw`select status, is_processed, last_error, dead_lettered_at from outbox_events where idempotency_key = ${'ad:meta:' + (event as any).event_id}`;
      expect(row).toMatchObject({ status: 'retrying', is_processed: false, dead_lettered_at: null });
      expect(row.last_error).toBe('meta HTTP 400: Meta error 4: (#4) Application request limit reached (fbtrace_id Lim4)');
    } finally {
      globalThis.fetch = realFetch;
      await raw`delete from outbox_events where idempotency_key like ${'ad:%:' + (event as any).event_id}`;
    }
  }, 30_000);

  it('the identity graph keeps the LAST click and when it changed; a malformed Meta click id is not stored', async () => {
    const { StitchBrowserIdentityUseCase } = await import('../../apps/api/src/application/use-cases/telemetry/StitchBrowserIdentityUseCase');
    const stitch = new StitchBrowserIdentityUseCase();
    const fp = visitorId();
    const first = 'fb.1.1790841530000.IwAR_first_click_ABCdef1234';
    const second = 'fb.1.1790841539999.IwAR_second_click_ABCdef123';
    const row = async () => (await raw`select fbc, twclid, click_ids_at, updated_at from first_party_identities where fp_client_id = ${fp}`)[0];

    await stitch.execute({ fp_client_id: fp, fbc: first, twclid: 'tw-1' } as never, '41.84.203.125', 'UA');
    const a = await row();
    expect([a.fbc, a.twclid]).toEqual([first, 'tw-1']);
    expect(a.click_ids_at).not.toBeNull();

    // A page with no ad click touches the row but is not a new click.
    // (Under vitest a Date bound as a query parameter loses its milliseconds, so the gaps are whole seconds.)
    await new Promise((r) => setTimeout(r, 1100));
    await stitch.execute({ fp_client_id: fp } as never, '41.84.203.125', 'UA');
    const b = await row();
    expect(new Date(b.click_ids_at).getTime()).toBe(new Date(a.click_ids_at).getTime());
    expect(new Date(b.updated_at).getTime()).toBeGreaterThan(new Date(a.updated_at).getTime());

    // A later ad click replaces the earlier one (it used to be ignored for ever)…
    await new Promise((r) => setTimeout(r, 1100));
    await stitch.execute({ fp_client_id: fp, fbc: second } as never, '41.84.203.125', 'UA');
    const c = await row();
    expect(c.fbc).toBe(second);
    // …ENTIRELY, as the browser's own record does: the stitch carries the
    // browser's current click, which no longer names X, so X's is cleared and
    // two networks are not both told about this visitor.
    expect(c.twclid).toBeNull();
    expect(new Date(c.click_ids_at).getTime()).toBeGreaterThan(new Date(a.click_ids_at).getTime());

    // Not Meta's format: not stored as a Meta click id, and the good one stays.
    await stitch.execute({ fp_client_id: fp, fbc: 'IwAR-raw-fbclid', fbp: '<script>' } as never, '41.84.203.125', 'UA');
    const d = await row();
    expect(d.fbc).toBe(second);
    expect(new Date(d.click_ids_at).getTime()).toBe(new Date(c.click_ids_at).getTime());
  }, 30_000);
});
