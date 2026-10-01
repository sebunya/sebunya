import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';

/**
 * What TikTok receives for browsing events, end to end, against real
 * PostgreSQL with only TikTok's HTTP endpoint stubbed:
 *
 *   - an event carries the hashed visitor id and, from the identity graph at
 *     send time, the TikTok click id the visitor arrived on;
 *   - TikTok's refusal is read from the body whatever the HTTP status: the row
 *     is NOT recorded as sent and keeps TikTok's own message; a rate limit,
 *     which TikTok answers with HTTP 401, is kept for another try and not
 *     mistaken for a bad token.
 */
const URL_ = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL_ && process.env.DATABASE_URL ? describe : describe.skip;
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

suite('TikTok conversions: browsing events and TikTok\'s own refusals (real PostgreSQL)', () => {
  let raw: any;
  let previous: any = null;
  const PIXEL = 'C0ABCDEFGH12345';
  const ENDPOINT = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';
  const visitors: string[] = [];
  const visitorId = () => { const fp = `fp.1790841536221.${randomUUID()}`; visitors.push(fp); return fp; };

  beforeAll(async () => {
    process.env.SEO_CREDENTIAL_VAULT_KEY = 'it-vault-key-for-tiktok-conversion-delivery-test';
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL_ as string, { max: 2, onnotice: () => undefined });
    const { IntegrationCredentialVault } = await import('../../apps/api/src/infrastructure/seo/IntegrationCredentialVault');
    const { DrizzleAdDestinationRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAdDestinationRepository');
    [previous] = await raw`select * from ad_destinations where platform = 'tiktok'`;
    await new DrizzleAdDestinationRepository().save('tiktok', {
      enabled: true, config: { pixelCode: PIXEL, ugxPerUsd: '4000' },
      secretEnc: IntegrationCredentialVault.fromEnv()!.encrypt({ apiKey: 'tt-token-' + 'x'.repeat(30) }), secretMask: '••••', updatedBy: null,
    });
  }, 60_000);

  afterAll(async () => {
    if (!raw) return;
    if (!previous) await raw`delete from ad_destinations where platform = 'tiktok'`;
    else await raw`update ad_destinations set enabled = ${previous.enabled}, config = ${raw.json(previous.config)}, secret_enc = ${previous.secret_enc}, secret_mask = ${previous.secret_mask} where platform = 'tiktok'`;
    if (visitors.length) await raw`delete from first_party_identities where fp_client_id = any(${visitors})`;
    await raw.end();
  });

  const run = async (events: any[], answer: (body: any) => Response) => {
    const { fanOutAdConversions, processAdConversionBatch } = await import('../../apps/api/src/infrastructure/advertising/AdConversionDispatch');
    const sent: Array<{ url: string; body: any; token: string }> = [];
    const realFetch = globalThis.fetch;
    const rows = new Map<string, any>();
    try {
      for (const e of events) expect(await fanOutAdConversions(e as never)).toBeGreaterThanOrEqual(1);
      globalThis.fetch = (async (url: string, init: any) => {
        const body = init?.body ? JSON.parse(init.body) : null;
        if (String(url) === ENDPOINT) { sent.push({ url: String(url), body, token: init.headers['Access-Token'] }); return answer(body); }
        return new Response('{}', { status: 200 });
      }) as never;
      await new Promise((r) => setTimeout(r, 1100));
      await processAdConversionBatch();
      for (const e of events) rows.set(e.event_id, (await raw`select status, is_processed, last_error from outbox_events where idempotency_key = ${'ad:tiktok:' + e.event_id}`)[0]);
    } finally {
      globalThis.fetch = realFetch;
      for (const e of events) await raw`delete from outbox_events where idempotency_key like ${'ad:%:' + e.event_id}`;
    }
    return { sent, rows };
  };
  const mk = (name: string, fp: string, extra: Record<string, unknown> = {}) => ({ event_name: name, event_id: randomUUID(), event_time: Math.floor(Date.now() / 1000), source: 'browser',
    page_location: 'https://shopgoldplus.com/products/it', user_data: { fp_client_id: fp, ip_address: '41.84.203.125', user_agent: 'UA' }, ...extra });

  it('a basket add and a search reach TikTok with the visitor\'s click id from the identity graph, products as TikTok names them, and no empty basket on a search', async () => {
    const fp = visitorId();
    await raw`insert into first_party_identities (fp_client_id, ttclid, click_ids_at) values (${fp}, 'E.C.P.it-click-123', now())`;
    const cart = mk('add_to_cart', fp, { ecommerce: { value: 45000, currency: 'UGX', items: [{ item_id: 'prod-1', item_name: 'IT item', item_category: 'Power Devices', price: 45000, quantity: 1 }] } });
    const search = mk('search', fp, { search_term: 'power bank', page_location: 'https://shopgoldplus.com/shop?search=power+bank' });
    const { sent, rows } = await run([cart, search], () => new Response(JSON.stringify({ code: 0, message: 'OK', request_id: 'ok1' }), { status: 200 }));
    const byId = new Map(sent.map((s) => [s.body.data[0].event_id, s]));
    const c = byId.get(cart.event_id)!;
    expect(c.token).toMatch(/^tt-token-/);
    expect(c.body).toMatchObject({ event_source: 'web', event_source_id: PIXEL });
    expect(c.body.data[0]).toMatchObject({ event: 'AddToCart', user: { external_id: sha(fp), ttclid: 'E.C.P.it-click-123', ip: '41.84.203.125', user_agent: 'UA' },
      page: { url: 'https://shopgoldplus.com/products/it' },
      properties: { content_type: 'product', content_ids: ['prod-1'], num_items: 1, currency: 'USD', value: 11.25, contents: [{ content_id: 'prod-1', content_name: 'IT item', content_category: 'Power Devices', quantity: 1, price: 11.25 }] } });
    expect(JSON.stringify(c.body)).not.toContain('UGX');                // not a currency TikTok lists
    expect(byId.get(search.event_id)!.body.data[0]).toMatchObject({ event: 'Search', properties: { search_string: 'power bank' } });
    expect(byId.get(search.event_id)!.body.data[0].properties.contents).toBeUndefined();
    expect(rows.get(cart.event_id)).toMatchObject({ status: 'sent', is_processed: true });
  }, 30_000);

  it('TikTok\'s refusal is read from the body: a bad payload (HTTP 400) is final with TikTok\'s message; a rate limit (HTTP 401, as TikTok sends it) is retried; a refusal inside a 200 is not "sent"', async () => {
    const view = (id: string) => mk('view_item', visitorId(), { ecommerce: { value: 1000, currency: 'UGX', items: [{ item_id: id, price: 1000, quantity: 1 }] } });
    const refused = view('prod-refused'), limited = view('prod-limited'), inside200 = view('prod-200');
    const { sent, rows } = await run([refused, limited, inside200], (body) => {
      const id = body?.data?.[0]?.contents?.[0]?.content_id ?? body?.data?.[0]?.properties?.contents?.[0]?.content_id;
      if (id === 'prod-limited') return new Response(JSON.stringify({ code: 40100, message: 'Too many requests', request_id: 'rl1' }), { status: 401 });
      if (id === 'prod-200') return new Response(JSON.stringify({ code: 40002, message: 'Refused inside a 200', request_id: 'in200' }), { status: 200 });
      return new Response(JSON.stringify({ code: 40002, message: 'Invalid event_source_id', request_id: 'bad1' }), { status: 400 });
    });
    expect(sent).toHaveLength(3);
    const r = rows.get(refused.event_id);
    expect(r.status).not.toBe('sent');
    expect(r.is_processed).toBe(true);                                   // final: the same payload would be refused again
    expect(String(r.last_error)).toContain('TikTok error 40002: Invalid event_source_id (request_id bad1)');
    const l = rows.get(limited.event_id);
    expect(l).toMatchObject({ status: 'retrying', is_processed: false });
    expect(String(l.last_error)).toContain('TikTok error 40100');
    const i = rows.get(inside200.event_id);
    expect(i.status).not.toBe('sent');
    expect(String(i.last_error)).toContain('Refused inside a 200');
  }, 30_000);
});
