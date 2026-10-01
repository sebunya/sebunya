import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Fixtures } from './helpers/fixtures';

/**
 * Click-to-WhatsApp advert attribution, end to end: the real HTTP app, the
 * real Registry and real PostgreSQL, with only Meta's endpoint stubbed.
 *
 *   advert chat (signed webhook) → the click id is kept against a hash of the
 *   number → the same number buys (an order on the site, or a WhatsApp sale an
 *   admin records) → the sale is reported to Meta against that advert.
 */
const URL_ = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL_ && process.env.DATABASE_URL ? describe : describe.skip;
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

suite('Click-to-WhatsApp adverts: webhook to credited sale (real app, real PostgreSQL)', () => {
  let raw: any;
  let app: any;
  let transition: any;
  let M: any;
  let ops: any;
  let fx: Fixtures;
  let productId: string;
  const orders: string[] = [];
  const sales: string[] = [];
  let previousDest: any = null;
  let previousCaps: any[] = [];
  const WABA = '102290129340398';
  const DATASET = '1234567890123456';
  const APP_SECRET = 'abcdef0123456789abcdef0123456789';
  const VERIFY = 'goldplus-itest-verify-token-2026';
  const TOKEN = 'EAAB' + 'w'.repeat(60);
  const tag = randomUUID().slice(0, 8);
  const sign = (body: string, secret = APP_SECRET) => `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
  const clid = (n: string) => `ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qp-${tag}-${n}`;
  /** A number unique to this run, in the three ways it shows up: WhatsApp's `from`, a checkout field, a hash. */
  const number = (i: number) => { const local = `7${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`.slice(0, 8) + String(i); return { wa: `256${local}`, typed: `0${local}`, hash: sha(`256${local}`) }; };
  const used: string[] = [];

  const delivery = (from: string, messageId: string, ctwaClid: string | null, atSec = Math.floor(Date.now() / 1000) - 60) => JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: WABA, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '256700000000', phone_number_id: '106540352242922' },
      contacts: [{ profile: { name: 'A Customer' }, wa_id: from }],
      messages: [{ from, id: messageId, timestamp: String(atSec), type: 'text', text: { body: 'Is this in stock? I live at Plot 9.' },
        ...(ctwaClid === null ? {} : { referral: { source_url: 'https://fb.me/abc', source_type: 'ad', source_id: `ad-${tag}`, headline: 'Power banks', ctwa_clid: ctwaClid } }) }] } }] }],
  });
  const post = (body: string, signature: string | null) => app.request('/webhooks/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) }, body });

  let priorOrigin: string | undefined;
  beforeAll(async () => {
    process.env.MEASUREMENT_ALLOW_NONPROD_DELIVERY = 'true';
    // The storefront's address, as production resolves it: a website purchase names the page it happened on (Meta requires it).
    priorOrigin = process.env.PUBLIC_SITE_ORIGIN;
    process.env.PUBLIC_SITE_ORIGIN = 'https://shopgoldplus.com';
    process.env.SEO_CREDENTIAL_VAULT_KEY = 'it-vault-key-for-whatsapp-ad-attribution-test';
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL_ as string, { max: 3, onnotice: () => undefined });
    app = (await import('../../apps/api/src/interfaces/http/app')).default;
    const { Registry } = await import('../../apps/api/src/infrastructure/Registry');
    ops = Registry.getInstance().advertisingOps;
    const { OrderTransitionService } = await import('../../apps/api/src/infrastructure/orders/OrderTransitionService');
    transition = new OrderTransitionService();
    M = await import('../../apps/api/src/infrastructure/measurement/DeliveryService');
    const { IntegrationCredentialVault } = await import('../../apps/api/src/infrastructure/seo/IntegrationCredentialVault');
    const { DrizzleAdDestinationRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAdDestinationRepository');
    const { DrizzleAdCapabilityRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAdvertisingOpsRepository');
    fx = new Fixtures(raw);
    productId = (await fx.product()).id;
    await raw`delete from measurement.control where key = 'kill_switch'`;
    [previousDest] = await raw`select * from ad_destinations where platform = 'meta'`;
    previousCaps = await raw`select * from ad_destination_capabilities where platform = 'meta'`;
    const vault = IntegrationCredentialVault.fromEnv()!;
    await new DrizzleAdDestinationRepository().save('meta', { enabled: true, config: { datasetId: DATASET }, secretEnc: vault.encrypt({ apiKey: TOKEN }), secretMask: '••••', updatedBy: null });
    const caps = new DrizzleAdCapabilityRepository();
    await caps.save('meta', 'offline', { enabled: true, config: {}, updatedBy: null });
    await caps.save('meta', 'whatsapp_ads', { enabled: true, config: { wabaId: WABA, windowDays: '7' },
      secretEnc: vault.encrypt({ apiKey: JSON.stringify({ appSecret: APP_SECRET, verifyToken: VERIFY }) }), secretMask: '••••', updatedBy: null });
  }, 90_000);

  afterAll(async () => {
    if (priorOrigin === undefined) delete process.env.PUBLIC_SITE_ORIGIN; else process.env.PUBLIC_SITE_ORIGIN = priorOrigin;
    if (!raw) return;
    await raw`delete from whatsapp_ad_referrals where source_id = ${`ad-${tag}`}`;
    if (sales.length) { await raw`delete from ad_offline_conversions where source_ref = any(${sales})`; await raw`delete from ad_offline_sales where id = any(${sales}::uuid[])`; }
    if (orders.length) {
      const evs = (await raw`select event_id from measurement.business_event where aggregate_id = any(${orders})`).map((r: any) => r.event_id);
      if (evs.length) {
        await raw`delete from measurement.delivery_attempt where delivery_id in (select delivery_id from measurement.delivery_intent where event_id = any(${evs}))`;
        await raw`delete from measurement.delivery_intent where event_id = any(${evs})`;
        await raw`delete from measurement.event_routing where event_id = any(${evs})`;
        await raw`delete from measurement.commercial_entry where event_id = any(${evs})`;
        await raw`delete from measurement.business_event where event_id = any(${evs})`;
      }
      await raw`delete from ad_offline_conversions where source_ref = any(${orders})`;
      await raw`delete from order_attribution where order_id = any(${orders})`;
      await raw`delete from order_events where order_id = any(${orders})`;
      await raw`delete from order_items where order_id = any(${orders})`;
      await raw`delete from orders where id = any(${orders})`;
    }
    await raw`delete from ad_destination_capabilities where platform = 'meta'`;
    for (const c of previousCaps) await raw`insert into ad_destination_capabilities ${raw(c)}`;
    if (!previousDest) await raw`delete from ad_destinations where platform = 'meta'`;
    else await raw`update ad_destinations set enabled = ${previousDest.enabled}, config = ${previousDest.config}, secret_enc = ${previousDest.secret_enc}, secret_mask = ${previousDest.secret_mask} where platform = 'meta'`;
    await fx?.cleanup();
    await raw.end();
  });

  const paidOrder = async (phoneTyped: string, clickIds: Record<string, string> | null) => {
    const on = `iw${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, customer_email, delivery_area, delivery_address,
      subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method)
      values (${on}, 'Sarah Nakato', ${phoneTyped}, null, 'Kira', 'Adr', 90000, 5000, 95000, 'received', 'unpaid', 'pesapal') returning id`;
    await raw`insert into order_items (order_id, product_id, sku, product_name, quantity, unit_price, final_line_total, cogs_snapshot_ugx)
      values (${o.id}, ${productId}, 'IW-SKU', 'IW item', 2, 45000, 90000, 55000)`;
    await raw`insert into order_attribution (order_id, order_number, fp_client_id, client_ip, user_agent, click_ids)
      values (${o.id}, ${on}, ${`fp.1790841536221.${randomUUID()}`}, '41.84.203.125', 'Mozilla/5.0 IW', ${clickIds ? raw.json(clickIds) : null})`;
    orders.push(o.id);
    await transition.transition(o.id, 'processing', { actorType: 'payment_provider', source: 'payment', reasonCode: 'pesapal_payment_completed', paymentStatus: 'paid', idempotencyKey: `pesapal:completed:iw-${o.id}` });
    await M.routeBusinessEvents();
    const intent = async () => (await raw`select i.* from measurement.delivery_intent i join measurement.business_event e using (event_id) where e.aggregate_id = ${o.id} and i.sink_key = 'ad:meta:purchase'`)[0];
    await raw`update measurement.delivery_intent set next_attempt_at = now() - interval '1 second', next_enqueue_at = now() - interval '1 second' where delivery_id = ${(await intent()).delivery_id}`;
    await M.scheduleDueDeliveries(async () => true);
    return { id: o.id as string, number: on, intent };
  };
  const recorder = () => {
    const calls: Array<{ url: string; init: any }> = [];
    const fetchImpl = (async (url: string, init: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'ok' }), { status: 200 }); }) as any;
    return { calls, fetchImpl };
  };

  it('Meta\'s subscription check is answered only for the saved verify token', async () => {
    const ok = await app.request(`/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('1158201444');
    expect((await app.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1158201444')).status).toBe(403);
    expect((await app.request('/webhooks/whatsapp')).status).toBe(403);
  });

  it('a delivery is kept only when Meta signed it; what is kept is a hash and a click id, never the number or the message', async () => {
    const n = number(1); used.push(n.hash);
    const body = delivery(n.wa, `wamid.${tag}.1`, clid('1'));
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, sign(body, 'f'.repeat(32)))).status).toBe(401);
    expect((await post(`${body} `, sign(body))).status).toBe(401);                                    // one byte changed after signing
    expect(await raw`select 1 from whatsapp_ad_referrals where message_id = ${`wamid.${tag}.1`}`).toHaveLength(0);

    expect((await post(body, sign(body))).status).toBe(200);
    expect((await post(body, sign(body))).status).toBe(200);                                         // Meta's retry of the same message
    const rows = await raw`select * from whatsapp_ad_referrals where message_id = ${`wamid.${tag}.1`}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ waba_id: WABA, sender_phone_sha256: n.hash, ctwa_clid: clid('1'), source_type: 'ad', source_id: `ad-${tag}`, headline: 'Power banks', attributed_count: 0 });
    const stored = JSON.stringify(rows[0]);
    for (const secret of [n.wa, 'A Customer', 'Is this in stock', 'Plot 9']) expect(stored, secret).not.toContain(secret);

    // An ordinary message, and one from another business's account, are acknowledged and not kept.
    const plain = delivery(n.wa, `wamid.${tag}.plain`, null);
    expect((await post(plain, sign(plain))).status).toBe(200);
    const foreign = delivery(n.wa, `wamid.${tag}.foreign`, clid('f')).replace(WABA, '999999999999999');
    expect((await post(foreign, sign(foreign))).status).toBe(200);
    expect(await raw`select 1 from whatsapp_ad_referrals where message_id in (${`wamid.${tag}.plain`}, ${`wamid.${tag}.foreign`})`).toHaveLength(0);
  });

  it('an order on the site by the same number is reported to Meta against the advert — once, as business messaging, not also as a website purchase', async () => {
    const n = number(2); used.push(n.hash);
    const body = delivery(n.wa, `wamid.${tag}.2`, clid('2'));
    expect((await post(body, sign(body))).status).toBe(200);
    const o = await paidOrder(n.typed, null);                                                        // typed 07…, as a customer would
    const i = await o.intent();
    const { calls, fetchImpl } = recorder();
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, fetchImpl)).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://graph.facebook.com/v25.0/${DATASET}/events`);
    expect(calls[0].url).not.toContain(TOKEN);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const sent = JSON.parse(calls[0].init.body);
    expect(sent.data).toHaveLength(1);
    expect(sent.data[0]).toEqual({
      event_name: 'Purchase', event_time: expect.any(Number), event_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      action_source: 'business_messaging', messaging_channel: 'whatsapp',
      user_data: { whatsapp_business_account_id: WABA, ctwa_clid: clid('2') },
      custom_data: { currency: 'UGX', value: 95000, order_id: o.number },
    });
    expect(await o.intent()).toMatchObject({ state: 'ACCEPTED', state_reason: 'OK_WHATSAPP_ADVERT' });
    const [ref] = await raw`select attributed_count, last_attributed_at from whatsapp_ad_referrals where message_id = ${`wamid.${tag}.2`}`;
    expect(ref.attributed_count).toBe(1);
    expect(ref.last_attributed_at).not.toBeNull();
  });

  it('one sale, one claim: a Meta web click after the chat keeps the sale a website purchase; a number with no advert chat is untouched', async () => {
    const n = number(3); used.push(n.hash);
    const chatAt = Math.floor(Date.now() / 1000) - 3600;
    const body = delivery(n.wa, `wamid.${tag}.3`, clid('3'), chatAt);
    expect((await post(body, sign(body))).status).toBe(200);
    const fbc = `fb.1.${(chatAt + 1800) * 1000}.IwAR2xQzAbC_dEf-GhIjKlMnOp`;                          // a web advert click half an hour AFTER the chat
    const o = await paidOrder(n.typed, { fbc });
    let i = await o.intent();
    const web = recorder();
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, web.fetchImpl)).toBe('ACCEPTED');
    const ev = JSON.parse(web.calls[0].init.body).data[0];
    expect(ev.action_source).toBe('website');
    expect(ev.user_data.fbc).toBe(fbc);
    expect(ev.user_data.ctwa_clid).toBeUndefined();
    expect((await o.intent()).state_reason).toBe('OK');
    expect((await raw`select attributed_count from whatsapp_ad_referrals where message_id = ${`wamid.${tag}.3`}`)[0].attributed_count).toBe(0);

    const stranger = number(4);
    const p = await paidOrder(stranger.typed, null);
    i = await p.intent();
    const plain = recorder();
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, plain.fetchImpl)).toBe('ACCEPTED');
    expect(JSON.parse(plain.calls[0].init.body).data[0].action_source).toBe('website');
  });

  it('a WhatsApp sale an admin records is reported against the advert the chat came from; one outside the window is a plain chat sale', async () => {
    const inside = number(5); used.push(inside.hash);
    const outside = number(6); used.push(outside.hash);
    const now = Math.floor(Date.now() / 1000);
    const b1 = delivery(inside.wa, `wamid.${tag}.5`, clid('5'), now - 2 * 86400);                     // chatted two days ago
    const b2 = delivery(outside.wa, `wamid.${tag}.6`, clid('6'), now - 9 * 86400);                    // chatted nine days ago: outside 7
    expect((await post(b1, sign(b1))).status).toBe(200);
    expect((await post(b2, sign(b2))).status).toBe(200);

    // The offline use case with the real repository and the real WhatsApp adverts use case, and a
    // gateway given a recording fetch: the production gateway keeps the fetch it was built with, so
    // replacing the global afterwards would not stop it reaching Meta.
    const { OfflineConversionUseCases } = await import('../../apps/api/src/application/use-cases/advertising/OfflineConversionUseCases');
    const { DrizzleOfflineConversionRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAdvertisingOpsRepository');
    const { HttpOfflineConversionGateway } = await import('../../apps/api/src/infrastructure/advertising/AdvertisingGateways');
    const sent: Array<{ url: string; body: any; auth: string }> = [];
    const recording = (async (url: string, init: any) => { sent.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization ?? '' }); return new Response(JSON.stringify({ events_received: 1 }), { status: 200 }); }) as never;
    const offline = new OfflineConversionUseCases(
      new DrizzleOfflineConversionRepository(), new HttpOfflineConversionGateway(recording),
      (platform: string) => ops.capabilities.live(platform, 'offline'),
      async () => ({ config: {}, secret: '', destinationConfig: { datasetId: DATASET }, destinationSecret: TOKEN, testMode: false }),
      { execute: async () => ({}) } as never, () => new Date(), ops.whatsappAds);

    const when = new Date(Date.now() - 3600_000).toISOString();
    const s1 = await offline.recordSale(null, { channel: 'WHATSAPP', occurredAt: when, valueUgx: 180000, phone: inside.typed });
    const s2 = await offline.recordSale(null, { channel: 'WHATSAPP', occurredAt: when, valueUgx: 60000, phone: outside.typed });
    expect(s1.ok && s2.ok).toBe(true);
    if (!s1.ok || !s2.ok) return;
    sales.push(s1.value.id, s2.value.id);
    await offline.enqueue();
    // Only this test's rows: the queue is shared, and nothing else in it is ours to send.
    await raw`update ad_offline_conversions set next_attempt_at = now() + interval '1 day' where not (source_ref = any(${sales})) and state = 'PENDING'`;
    try { await offline.dispatch(50); } finally {
      await raw`update ad_offline_conversions set next_attempt_at = now() where not (source_ref = any(${sales})) and state = 'PENDING' and next_attempt_at > now() + interval '23 hours'`;
    }

    const mine = sent.filter((s) => s.url === `https://graph.facebook.com/v25.0/${DATASET}/events`).map((s) => s.body.data[0]);
    expect(sent.every((s) => s.auth === `Bearer ${TOKEN}` && !s.url.includes(TOKEN))).toBe(true);
    const credited = mine.find((e: any) => e.user_data?.ctwa_clid === clid('5'));
    expect(credited).toMatchObject({ event_name: 'Purchase', action_source: 'business_messaging', messaging_channel: 'whatsapp',
      user_data: { whatsapp_business_account_id: WABA, ctwa_clid: clid('5') }, custom_data: { currency: 'UGX', value: 180000 } });
    expect(Object.keys(credited.user_data).sort()).toEqual(['ctwa_clid', 'whatsapp_business_account_id']);
    const plain = mine.find((e: any) => e.custom_data?.value === 60000);
    expect(plain).toMatchObject({ event_name: 'Purchase', action_source: 'chat', user_data: { ph: [outside.hash] } });
    expect(plain.user_data.ctwa_clid).toBeUndefined();
    expect(mine.some((e: any) => e.user_data?.ctwa_clid === clid('6'))).toBe(false);

    const rows = await raw`select source_ref, state, reason from ad_offline_conversions where source_ref = any(${sales}) and platform = 'meta'`;
    expect(rows.find((r: any) => r.source_ref === s1.value.id)).toMatchObject({ state: 'SENT', reason: 'Reported against a Click-to-WhatsApp advert.' });
    expect(rows.find((r: any) => r.source_ref === s2.value.id)).toMatchObject({ state: 'SENT' });
    expect((await raw`select attributed_count from whatsapp_ad_referrals where message_id = ${`wamid.${tag}.5`}`)[0].attributed_count).toBe(1);
    expect((await raw`select attributed_count from whatsapp_ad_referrals where message_id = ${`wamid.${tag}.6`}`)[0].attributed_count).toBe(0);
  }, 60_000);

  it('without the WhatsApp Business Platform: a sale recorded with the chat\'s reference code carries the advert click of the visitor the code was issued to', async () => {
    const { OfflineConversionUseCases } = await import('../../apps/api/src/application/use-cases/advertising/OfflineConversionUseCases');
    const { DrizzleOfflineConversionRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAdvertisingOpsRepository');
    const { HttpOfflineConversionGateway } = await import('../../apps/api/src/infrastructure/advertising/AdvertisingGateways');
    const { environmentOf } = await import('../../apps/api/src/domain/measurement/BusinessEvents');
    const envName = environmentOf(process.env.NODE_ENV);
    const A = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
    const code = () => `GP-${Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join('')}`;
    const visitor = () => `fp.1790841536221.${randomUUID()}`;
    // 1: arrived on a Facebook advert two days ago, tapped the site's WhatsApp link, bought in the chat.
    const fromAdvert = { fp: visitor(), ref: code(), fbc: 'fb.1.1790841538888.IwAR_ref_bridge_ABCdef123' };
    // 2: tapped the WhatsApp link, but clicked an advert only AFTER the sale: that click did not lead to it.
    const clickedLater = { fp: visitor(), ref: code(), fbc: 'fb.1.1790841539999.IwAR_too_late_ABCdef123' };
    // 3: tapped the WhatsApp link with no advert behind the visit.
    const organic = { fp: visitor(), ref: code() };
    const saleAt = new Date(Date.now() - 3600_000);
    await raw`insert into first_party_identities (fp_client_id, fbc, click_ids_at) values (${fromAdvert.fp}, ${fromAdvert.fbc}, now() - interval '2 days')`;
    await raw`insert into first_party_identities (fp_client_id, fbc, click_ids_at) values (${clickedLater.fp}, ${clickedLater.fbc}, now())`;
    for (const v of [fromAdvert, clickedLater, organic]) {
      await raw`insert into measurement.whatsapp_ref (code, environment, anonymous_id, client_event_id, issued_at, page_path) values (${v.ref}, ${envName}, ${v.fp}, ${randomUUID()}, now() - interval '3 hours', '/wa')`;
    }
    const sent: Array<{ url: string; body: any }> = [];
    const recording = (async (url: string, init: any) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ events_received: 1 }), { status: 200 }); }) as never;
    const offline = new OfflineConversionUseCases(
      new DrizzleOfflineConversionRepository(), new HttpOfflineConversionGateway(recording),
      (platform: string) => ops.capabilities.live(platform, 'offline'),
      async () => ({ config: {}, secret: '', destinationConfig: { datasetId: DATASET }, destinationSecret: TOKEN, testMode: false }),
      { execute: async () => ({}) } as never, () => new Date(), null);
    const mine: string[] = [];
    try {
      // The code alone is enough to record the sale: no phone, no order number. Typed as staff would, lower case and spaced.
      const s1 = await offline.recordSale(null, { channel: 'WHATSAPP', occurredAt: saleAt.toISOString(), valueUgx: 210000, whatsappRef: ` ${fromAdvert.ref.toLowerCase()} ` });
      const s2 = await offline.recordSale(null, { channel: 'WHATSAPP', occurredAt: saleAt.toISOString(), valueUgx: 70000, whatsappRef: clickedLater.ref, phone: '0772 555 010' });
      const s3 = await offline.recordSale(null, { channel: 'WHATSAPP', occurredAt: saleAt.toISOString(), valueUgx: 50000, whatsappRef: organic.ref });
      expect(s1.ok && s2.ok && s3.ok).toBe(true);
      if (!s1.ok || !s2.ok || !s3.ok) return;
      mine.push(s1.value.id, s2.value.id, s3.value.id); sales.push(...mine);
      // A code the site never issued is refused, in words staff can act on.
      const unknown = await offline.recordSale(null, { channel: 'WHATSAPP', occurredAt: saleAt.toISOString(), valueUgx: 1000, whatsappRef: 'GP-222222' });
      expect(unknown).toMatchObject({ ok: false, code: 'NOT_FOUND' });
      expect((await raw`select whatsapp_ref, consent_fp_client_ids from ad_offline_sales where id = ${s1.value.id}`)[0]).toMatchObject({ whatsapp_ref: fromAdvert.ref, consent_fp_client_ids: [fromAdvert.fp] });

      await offline.enqueue();
      await raw`update ad_offline_conversions set next_attempt_at = now() + interval '1 day' where not (source_ref = any(${mine})) and state = 'PENDING'`;
      try { await offline.dispatch(50); } finally {
        await raw`update ad_offline_conversions set next_attempt_at = now() where not (source_ref = any(${mine})) and state = 'PENDING' and next_attempt_at > now() + interval '23 hours'`;
      }
      const events = sent.filter((s) => s.url === `https://graph.facebook.com/v25.0/${DATASET}/events`).map((s) => s.body.data[0]);
      const credited = events.find((e: any) => e.custom_data?.value === 210000);
      // The advert's click id, and the same visitor ids the browsing events carried.
      expect(credited).toMatchObject({ event_name: 'Purchase', action_source: 'chat' });
      expect(credited.user_data).toEqual({ fbc: fromAdvert.fbc, external_id: [createHash('sha256').update(fromAdvert.fp).digest('hex')], fbp: expect.stringMatching(/^fb\.1\.1790841536221\.[1-9]\d{9}$/) });
      const later = events.find((e: any) => e.custom_data?.value === 70000);
      expect(later.user_data.fbc).toBeUndefined();                       // the click came after the sale
      expect(later.user_data.ph).toHaveLength(1);
      // No advert click and no contact: there is nothing Meta could match the sale on, and it says so.
      expect(events.some((e: any) => e.custom_data?.value === 50000)).toBe(false);
      const rows = await raw`select source_ref, state, reason from ad_offline_conversions where source_ref = any(${mine}) and platform = 'meta'`;
      expect(rows.find((r: any) => r.source_ref === s1.value.id)).toMatchObject({ state: 'SENT' });
      expect(rows.find((r: any) => r.source_ref === s3.value.id)).toMatchObject({ state: 'SKIPPED' });
    } finally {
      await raw`delete from measurement.whatsapp_ref where code = any(${[fromAdvert.ref, clickedLater.ref, organic.ref]})`;
      await raw`delete from first_party_identities where fp_client_id = any(${[fromAdvert.fp, clickedLater.fp]})`;
    }
  }, 60_000);

  it('switched off: deliveries are acknowledged and not kept, and no sale is credited', async () => {
    await raw`update ad_destination_capabilities set enabled = false where platform = 'meta' and capability = 'whatsapp_ads'`;
    try {
      const n = number(7);
      const body = delivery(n.wa, `wamid.${tag}.7`, clid('7'));
      expect((await post(body, sign(body))).status).toBe(200);
      expect(await raw`select 1 from whatsapp_ad_referrals where message_id = ${`wamid.${tag}.7`}`).toHaveLength(0);
      expect(await ops.whatsappAds.attributionFor(used[1], new Date())).toBeNull();                 // even a stored referral is not used while off
      const overview = await ops.whatsappAds.overview('https://api.example/webhooks/whatsapp');
      expect(overview).toMatchObject({ configured: true, live: false, wabaId: WABA });
      expect(JSON.stringify(overview)).not.toContain(APP_SECRET);
    } finally {
      await raw`update ad_destination_capabilities set enabled = true where platform = 'meta' and capability = 'whatsapp_ads'`;
    }
  });
});
