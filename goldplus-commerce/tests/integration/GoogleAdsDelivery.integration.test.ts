import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { Fixtures } from './helpers/fixtures';

/**
 * Google Ads, end to end against real PostgreSQL, with only Google's HTTP endpoints stubbed (2026-10-16):
 * a paid order from a Google click reaches the Data Manager API with its click id, value, SKU and new/returning
 * flag under a service-account token; a settled partial refund restates the same transaction at the value kept.
 */
const URL_ = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL_ && process.env.DATABASE_URL ? describe : describe.skip;

suite('Google Ads conversions through the Data Manager API (real PostgreSQL)', () => {
  let raw: any;
  let transition: any;
  let M: any;
  let fx: Fixtures;
  let productId: string;
  const orders: string[] = [];
  let previous: any = null;
  const tokenCalls: string[] = [];

  beforeAll(async () => {
    process.env.MEASUREMENT_ALLOW_NONPROD_DELIVERY = 'true';
    process.env.SEO_CREDENTIAL_VAULT_KEY = 'it-vault-key-for-google-ads-delivery-test';
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL_ as string, { max: 2, onnotice: () => undefined });
    const { OrderTransitionService } = await import('../../apps/api/src/infrastructure/orders/OrderTransitionService');
    transition = new OrderTransitionService();
    M = await import('../../apps/api/src/infrastructure/measurement/DeliveryService');
    const { IntegrationCredentialVault } = await import('../../apps/api/src/infrastructure/seo/IntegrationCredentialVault');
    const { DrizzleAdDestinationRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAdDestinationRepository');
    fx = new Fixtures(raw);
    productId = (await fx.product()).id;
    await raw`delete from measurement.control where key = 'kill_switch'`;
    [previous] = await raw`select * from ad_destinations where platform = 'google_ads'`;
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const sa = JSON.stringify({ type: 'service_account', client_email: 'goldplus-ads@it.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
    await new DrizzleAdDestinationRepository().save('google_ads', {
      enabled: true, config: { customerId: '9161339749', conversionActionId: '7001', merchantCenterId: '5551234' },
      secretEnc: IntegrationCredentialVault.fromEnv()!.encrypt({ apiKey: sa }), secretMask: '••••', updatedBy: null,
    });
    // Google's token endpoint (the service-account sign-in uses the global fetch).
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (url: any, init: any) => {
      if (String(url) === 'https://oauth2.googleapis.com/token') {
        tokenCalls.push(String(init?.body ?? ''));
        return new Response(JSON.stringify({ access_token: 'ya29.it-token', expires_in: 3600 }), { status: 200 });
      }
      return realFetch(url, init);
    }) as any);
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (!raw) return;
    if (!previous) await raw`delete from ad_destinations where platform = 'google_ads'`;
    else await raw`update ad_destinations set enabled = ${previous.enabled}, config = ${previous.config}, secret_enc = ${previous.secret_enc}, secret_mask = ${previous.secret_mask} where platform = 'google_ads'`;
    if (orders.length) {
      const evs = (await raw`select event_id from measurement.business_event where aggregate_id = any(${orders})`).map((r: any) => r.event_id);
      if (evs.length) {
        await raw`delete from measurement.delivery_attempt where delivery_id in (select delivery_id from measurement.delivery_intent where event_id = any(${evs}))`;
        await raw`delete from measurement.delivery_intent where event_id = any(${evs})`;
        await raw`delete from measurement.event_routing where event_id = any(${evs})`;
        await raw`delete from measurement.commercial_entry where event_id = any(${evs})`;
        await raw`delete from measurement.business_event where event_id = any(${evs})`;
      }
      await raw`delete from payment_refunds where order_id = any(${orders})`;
      await raw`delete from payment_attempts where order_id = any(${orders})`;
      await raw`delete from order_attribution where order_id = any(${orders})`;
      await raw`delete from order_events where order_id = any(${orders})`;
      await raw`delete from order_items where order_id = any(${orders})`;
      await raw`delete from orders where id = any(${orders})`;
    }
    await fx?.cleanup();
    await raw.end({ timeout: 5 });
  });

  const insertOrder = async (o: { phone: string; status?: string; payment?: string; createdAt?: Date }) => {
    const on = `ga${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [row] = await raw`insert into orders (order_number, customer_name, customer_phone, customer_email, delivery_area, delivery_address, delivery_location,
      subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method, created_at)
      values (${on}, 'Sarah Nakato', ${o.phone}, 'buyer@example.com', 'Kira', 'Adr', ${raw.json({ district: 'Wakiso', displayLabel: 'Kira, Wakiso' })},
      90000, 5000, 95000, ${o.status ?? 'received'}, ${o.payment ?? 'unpaid'}, 'pesapal', ${o.createdAt ?? new Date()}) returning id`;
    orders.push(row.id);
    return { id: row.id as string, number: on };
  };

  const paidGoogleOrder = async (phone: string) => {
    const o = await insertOrder({ phone });
    await raw`insert into order_items (order_id, product_id, sku, product_name, quantity, unit_price, final_line_total, cogs_snapshot_ugx)
      values (${o.id}, ${productId}, 'GA-SKU', 'GA item', 2, 45000, 90000, 55000)`;
    await raw`insert into order_attribution (order_id, order_number, fp_client_id, client_ip, user_agent, click_ids)
      values (${o.id}, ${o.number}, ${`fp.1.${randomUUID()}`}, '41.84.203.125', 'Mozilla/5.0 GA', ${raw.json({ gclid: 'Cj0KCQjwGA-it', src: 'google' })})`;
    await transition.transition(o.id, 'processing', { actorType: 'payment_provider', source: 'payment', reasonCode: 'pesapal_payment_completed', paymentStatus: 'paid', idempotencyKey: `pesapal:completed:ga-${o.id}` });
    await M.routeBusinessEvents();
    return o;
  };

  const dueIntent = async (orderId: string, sink: string) => {
    const pick = async () => (await raw`select i.* from measurement.delivery_intent i join measurement.business_event e using (event_id)
      where e.aggregate_id = ${orderId} and i.sink_key = ${sink}`)[0];
    const i = await pick();
    if (!i) return null;
    await raw`update measurement.delivery_intent set next_attempt_at = now() - interval '1 second', next_enqueue_at = now() - interval '1 second' where delivery_id = ${i.delivery_id}`;
    await M.scheduleDueDeliveries(async () => true);
    return pick();
  };

  const recorder = () => {
    const calls: Array<{ url: string; init: any }> = [];
    const fetchImpl = (async (url: string, init: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ requestId: 'req-1' }), { status: 200 }); }) as any;
    return { calls, fetchImpl };
  };

  it('a returning buyer\'s paid order from a Google click: one ingest call with click id, value, SKU and RETURNING', async () => {
    // An earlier paid order by the same number, typed another way.
    await insertOrder({ phone: '+256 772 555 101', payment: 'paid', status: 'processing', createdAt: new Date(Date.now() - 30 * 86_400_000) });
    const o = await paidGoogleOrder('0772555101');
    const i = await dueIntent(o.id, 'ad:google_ads:purchase');
    expect(i).toBeTruthy();
    const { calls, fetchImpl } = recorder();
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, fetchImpl)).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://datamanager.googleapis.com/v1/events:ingest');
    expect(calls[0].init.headers.Authorization).toBe('Bearer ya29.it-token');
    expect(tokenCalls.some((b) => b.includes('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'))).toBe(true);
    const body = JSON.parse(calls[0].init.body);
    expect(body.destinations[0]).toEqual({ operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '9161339749' }, productDestinationId: '7001' });
    const ev = body.events[0];
    expect(ev).toMatchObject({ transactionId: o.number, conversionValue: 95000, currency: 'UGX', eventSource: 'WEB', adIdentifiers: { gclid: 'Cj0KCQjwGA-it' } });
    expect(ev.userProperties).toEqual({ customerType: 'RETURNING' });
    expect(ev.cartData).toEqual({ merchantId: '5551234', items: [{ merchantProductId: 'GA-SKU', quantity: '2', unitPrice: 45000 }] });
    expect(ev.userData.userIdentifiers.length).toBe(2);
    expect(calls[0].init.body).not.toMatch(/buyer@example\.com|0772555101/);
  });

  it('a settled partial refund restates the same transaction at the value kept', async () => {
    const o = await paidGoogleOrder('0772555202');
    const p = await dueIntent(o.id, 'ad:google_ads:purchase');
    expect(await M.deliverOne(p.delivery_id, p.enqueue_generation, recorder().fetchImpl)).toBe('ACCEPTED');
    const [att] = await raw`insert into payment_attempts (order_id, merchant_reference, amount, status, provider)
      values (${o.id}, ${'ga-ref-' + o.number}, 95000, 'completed', 'pesapal') returning id`;
    const [ref] = await raw`insert into payment_refunds (payment_attempt_id, order_id, idempotency_key, amount_ugx, reason, status)
      values (${att.id}, ${o.id}, ${'ga-refkey-' + o.number}, 30000, 'GA partial', 'requested') returning id`;
    const { DrizzleRefundLedgerRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleRefundLedgerRepository');
    await new DrizzleRefundLedgerRepository().recordProviderOutcome(ref.id, { status: 'settled', providerStatus: 'OK' });
    await M.routeBusinessEvents();
    const r = await dueIntent(o.id, 'ad:google_ads:restate');
    expect(r).toBeTruthy();
    const { calls, fetchImpl } = recorder();
    expect(await M.deliverOne(r.delivery_id, r.enqueue_generation, fetchImpl)).toBe('ACCEPTED');
    const ev = JSON.parse(calls[0].init.body).events[0];
    expect(ev).toMatchObject({ transactionId: o.number, conversionValue: 65000, currency: 'UGX', adIdentifiers: { gclid: 'Cj0KCQjwGA-it' } });
  });

  it('a first-time buyer is NEW', async () => {
    const o = await paidGoogleOrder('0772555303');
    const i = await dueIntent(o.id, 'ad:google_ads:purchase');
    const { calls, fetchImpl } = recorder();
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, fetchImpl)).toBe('ACCEPTED');
    expect(JSON.parse(calls[0].init.body).events[0].userProperties).toEqual({ customerType: 'NEW' });
  });

  it('Google is asked how the upload ended: a rejection after acceptance marks the delivery failed (2026-10-22)', async () => {
    const o = await paidGoogleOrder('0772555404');
    const i = await dueIntent(o.id, 'ad:google_ads:purchase');
    expect(await M.deliverOne(i.delivery_id, i.enqueue_generation, recorder().fetchImpl)).toBe('ACCEPTED');
    const [a] = await raw`select safe_response from measurement.delivery_attempt where delivery_id = ${i.delivery_id} order by attempt_no desc limit 1`;
    expect(a.safe_response).toMatchObject({ googleRequestId: 'req-1', googleConfirmation: 'WAITING' });
    // Old enough to ask about (Google is given two minutes first).
    await raw`update measurement.delivery_attempt set started_at = now() - interval '5 minutes' where delivery_id = ${i.delivery_id}`;
    const asked: string[] = [];
    const status = (async (url: string) => {
      asked.push(String(url));
      return new Response(JSON.stringify({ requestStatusPerDestination: [{ requestStatus: 'FAILED', errorInfo: { errorCounts: [{ reason: 'INVALID_GCLID', recordCount: '1' }] } }] }), { status: 200 });
    }) as any;
    const r = await M.confirmGoogleUploads(status, 100);
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect(asked.some((u) => u.includes('requestStatus:retrieve?requestId=req-1'))).toBe(true);
    const [intent] = await raw`select state, state_reason from measurement.delivery_intent where delivery_id = ${i.delivery_id}`;
    expect(intent.state).toBe('DEAD_LETTER');
    expect(intent.state_reason).toMatch(/GOOGLE_PROCESSING_FAILED: INVALID_GCLID: 1/);
    // Asked once: the second sweep finds nothing waiting for it.
    asked.length = 0;
    await M.confirmGoogleUploads(status, 100);
    expect(asked.some((u) => u.includes(i.delivery_id))).toBe(false);
  });
});

