import { describe, it, expect } from 'vitest';
import { META_GRAPH_VERSION_RELEASED, AD_PLATFORMS, buildAdRequest, adPlatformAccepts, adSkipReason, adErrorSummary, metaUserData, metaMatchable, metaCustomData, metaErrorSummary, xSendScope, X_EVENT_FIELD, hashEmail, hashPhone, hashPhonePlus, normalisePhoneUg, linkedInVersion, META_GRAPH_VERSION } from '../../apps/api/src/infrastructure/advertising/AdPlatforms';
import { AdDestinationUseCases } from '../../apps/api/src/application/use-cases/advertising/AdDestinationUseCases';

const purchase: any = {
  event_name: 'purchase', event_id: '11111111-1111-4111-8111-111111111111', event_time: 1790000000, source: 'server',
  page_location: 'https://shopgoldplus.com/checkout',
  user_data: { fp_client_id: 'fp.1.x', ip_address: '41.84.203.125', user_agent: 'UA', hashed_email: hashEmail(' Buyer@Example.com '), hashed_phone: hashPhone('0772 123 456'), hashed_phone_plus: hashPhonePlus('0772 123 456') },
  ecommerce: { transaction_id: 'GP-1', value: 145000, currency: 'UGX', items: [{ item_id: 'p1', item_name: 'Power bank', price: 145000, quantity: 1 }] },
};

describe('advertising platforms: request builders', () => {
  it('normalises Ugandan phones to E.164 digits before hashing; emails lower-cased and trimmed', () => {
    expect(normalisePhoneUg('0772 123 456')).toBe('256772123456');
    expect(normalisePhoneUg('+256 772 123456')).toBe('256772123456');
    expect(normalisePhoneUg('772123456')).toBe('256772123456');
    expect(normalisePhoneUg('12')).toBeUndefined();
    expect(hashEmail(' Buyer@Example.com ')).toBe(hashEmail('buyer@example.com'));
    expect(hashEmail('not-an-email')).toBeUndefined();
  });
  it('Meta: Purchase to the dataset with hashed ids, IP/UA, value and order id; the token only in the Authorization header', () => {
    const r = buildAdRequest('meta', purchase, { datasetId: '1234567890123' }, 'TOKEN_x')!;
    expect(r.url).toBe('https://graph.facebook.com/v25.0/1234567890123/events');
    expect(r.url).not.toContain('TOKEN_x');
    expect(r.headers.Authorization).toBe('Bearer TOKEN_x');
    const d = (r.body as any).data[0];
    expect([d.event_name, d.action_source, d.event_id, d.custom_data.value, d.custom_data.order_id, d.custom_data.currency]).toEqual(['Purchase', 'website', purchase.event_id, 145000, 'GP-1', 'UGX']);
    expect(d.user_data.em[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(d.user_data.client_ip_address).toBe('41.84.203.125');
  });
  it('Meta: every match key the event carries is sent in Meta\'s form; a malformed one is left out, not sent to be rejected', () => {
    const fbc = 'fb.1.1790841536221.IwAR2xQzAbC_dEf-GhIjKlMnOp';
    const fbp = 'fb.1.1790841536221.4821093375';
    const h = (c: string) => c.repeat(64);
    const r = buildAdRequest('meta', { ...purchase, user_data: { ...purchase.user_data, fbc, fbp,
      hashed_first_name: h('a'), hashed_last_name: h('b'), hashed_city: h('c'), hashed_country: h('d') } } as never, { datasetId: '1234567890123' }, 'T')!;
    const ud = (r.body as any).data[0].user_data;
    expect(Object.keys(ud).sort()).toEqual(['client_ip_address', 'client_user_agent', 'country', 'ct', 'em', 'external_id', 'fbc', 'fbp', 'fn', 'ln', 'ph']);
    expect([ud.fn, ud.ln, ud.ct, ud.country]).toEqual([[h('a')], [h('b')], [h('c')], [h('d')]]);
    expect([ud.fbc, ud.fbp]).toEqual([fbc, fbp]);                        // never hashed, never altered
    expect(ud.external_id[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(ud.client_user_agent).toBe('UA');
    // No key is sent as undefined or empty.
    expect(JSON.stringify(ud)).not.toMatch(/null|undefined|\[\]/);
    const bad = buildAdRequest('meta', { ...purchase, user_data: { ...purchase.user_data, fbc: 'IwAR-raw-fbclid-not-a-click-id', fbp: 'GA1.2.3.4', hashed_city: 'wakiso' } } as never, { datasetId: '1234567890123' }, 'T')!;
    const bu = (bad.body as any).data[0].user_data;
    expect(bu.fbc).toBeUndefined(); expect(bu.fbp).toBeUndefined(); expect(bu.ct).toBeUndefined();
    expect(metaUserData(purchase as never)).toEqual(bu);
  });
  it('Meta: an event with nothing to match a person on is not sent — an IP address and a browser are not a person', () => {
    const cfg = { datasetId: '1234567890123' };
    const anon = { ...purchase, event_name: 'view_item', user_data: { ip_address: '41.84.203.125', user_agent: 'UA' } } as never;
    expect(buildAdRequest('meta', anon, cfg, 'T')).toBeNull();
    expect(adSkipReason('meta', anon, cfg)).toBe('NO_IDENTIFIER');
    expect(metaMatchable({ client_ip_address: '41.84.203.125', client_user_agent: 'UA' })).toBe(false);
    // Any one of: email, phone, click id, browser id, visitor id.
    for (const key of ['em', 'ph', 'fbc', 'fbp', 'external_id']) expect(metaMatchable({ [key]: 'x' }), key).toBe(true);
    // A browsing event from a visitor we know only by our own visitor id is still matchable.
    expect(buildAdRequest('meta', { ...purchase, event_name: 'view_item', user_data: { fp_client_id: 'fp.1.x', ip_address: '41.84.203.125', user_agent: 'UA' } } as never, cfg, 'T')).not.toBeNull();
    // Test mode with no test code sends nothing, and says why.
    expect(buildAdRequest('meta', purchase, { ...cfg, _test: '1' }, 'T')).toBeNull();
    expect(adSkipReason('meta', purchase, { ...cfg, _test: '1' })).toBe('NO_TEST_CODE');
    // With the code, a test send carries it and is otherwise the same event.
    expect((buildAdRequest('meta', purchase, { ...cfg, _test: '1', testEventCode: 'TEST12345' }, 'T')!.body as any).test_event_code).toBe('TEST12345');
  });
  it('Meta: what the event was about — a purchase states value, currency and order; a lead has no empty basket', () => {
    const cfg = { datasetId: '1234567890123' };
    const d = (e: unknown) => (buildAdRequest('meta', e as never, cfg, 'T')!.body as any).data[0];
    const p = d(purchase);
    expect(p.custom_data).toEqual({ currency: 'UGX', value: 145000, content_type: 'product', content_ids: ['p1'], contents: [{ id: 'p1', quantity: 1, item_price: 145000 }], num_items: 1, order_id: 'GP-1' });
    expect(p.event_source_url).toBe('https://shopgoldplus.com/checkout');
    expect(p.data_processing_options).toEqual([]);
    const cart = d({ ...purchase, event_name: 'add_to_cart', ecommerce: { value: 90000, currency: 'UGX', items: [{ item_id: 'p1', price: 45000, quantity: 2 }] } });
    expect(cart.event_name).toBe('AddToCart');
    expect(cart.custom_data).toEqual({ currency: 'UGX', value: 90000, content_type: 'product', content_ids: ['p1'], contents: [{ id: 'p1', quantity: 2, item_price: 45000 }], num_items: 2 });
    expect(cart.custom_data.order_id).toBeUndefined();                 // an order number belongs to a purchase
    const chat = d({ ...purchase, event_name: 'generate_lead', lead: { method: 'whatsapp' }, ecommerce: undefined });
    expect(chat.event_name).toBe('Contact');
    expect(chat).not.toHaveProperty('custom_data');
    const quote = d({ ...purchase, event_name: 'generate_lead', lead: { method: 'quote_request' }, ecommerce: { value: 500000, currency: 'UGX' } });
    expect(quote.event_name).toBe('Lead');
    expect(quote.custom_data).toEqual({ currency: 'UGX', value: 500000 });
    expect(metaCustomData(purchase as never, 'Contact')).toEqual({ currency: 'UGX', value: 145000 });
  });
  it('Meta: a search, a new account and a directions tap are its standard events, with no basket; a wishlist or a booking is never invented', () => {
    const cfg = { datasetId: '1234567890123' };
    const d = (name: string) => (buildAdRequest('meta', { ...purchase, event_name: name, source: 'browser', ecommerce: undefined, page_location: 'https://shopgoldplus.com/shop?search=charger' } as never, cfg, 'T')!.body as any).data[0];
    for (const [ours, metas] of [['search', 'Search'], ['sign_up', 'CompleteRegistration'], ['find_location', 'FindLocation']] as const) {
      const e = d(ours);
      expect(e.event_name).toBe(metas);
      expect(e.action_source).toBe('website');
      expect(e.event_source_url).toBe('https://shopgoldplus.com/shop?search=charger');   // required by Meta for a website event
      expect(e.user_data.client_user_agent).toBe('UA');                                    // required by Meta for a website event
      expect(e).not.toHaveProperty('custom_data');
    }
    const sent = Object.values(AD_PLATFORMS.find((p) => p.key === 'meta')!.events);
    expect(sent).not.toContain('AddToWishlist');
    expect(sent).not.toContain('Schedule');
    // Only Meta has these three; no other platform is sent an event it has no name for.
    for (const p of AD_PLATFORMS.filter((x) => x.key !== 'meta')) for (const n of ['search', 'sign_up', 'find_location']) expect((p.events as Record<string, string>)[n]).toBeUndefined();
  });
  it('Meta: its own account of a refusal is kept — code, subcode, message, trace id — and a rate limit is not a final answer', () => {
    const body = (e: object) => JSON.stringify({ error: e });
    const token = metaErrorSummary(400, body({ message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190, error_subcode: 463, fbtrace_id: 'AbC123' }))!;
    expect(token).toEqual({ message: 'Meta error 190/463: Error validating access token: Session has expired (fbtrace_id AbC123)', transient: false, credentials: true });
    const invalid = metaErrorSummary(400, body({ message: 'Invalid parameter', code: 100, error_subcode: 2804019, error_user_title: 'Server Side Api Parameter Error', error_user_msg: 'The parameter $[\'data\'][0][\'user_data\'] is required', fbtrace_id: 'Zz9' }))!;
    expect(invalid.message).toBe('Meta error 100/2804019: Server Side Api Parameter Error: The parameter $[\'data\'][0][\'user_data\'] is required (fbtrace_id Zz9)');
    expect(invalid).toMatchObject({ transient: false, credentials: false });
    // Rate limits and temporary faults arrive as HTTP 400 too.
    for (const code of [1, 2, 4, 17, 32, 613, 80004]) expect(metaErrorSummary(400, body({ message: 'limit', code }))!.transient, String(code)).toBe(true);
    expect(metaErrorSummary(400, body({ message: 'busy', code: 999, is_transient: true }))!.transient).toBe(true);
    for (const junk of ['', 'not json', '{}', '{"error":"string"}', '[]']) expect(metaErrorSummary(500, junk), junk).toBeNull();
    expect(adErrorSummary('meta', 400, body({ message: 'x', code: 190 }))!.credentials).toBe(true);
    // The exact bodies the live Graph API returned on 2026-10-01 for a junk token and for none.
    expect(metaErrorSummary(400, '{"error":{"message":"Invalid OAuth access token - Cannot parse access token","type":"OAuthException","code":190,"fbtrace_id":"AkTjua8CTo5ri1vH6MN6z4e"}}'))
      .toEqual({ message: 'Meta error 190: Invalid OAuth access token - Cannot parse access token (fbtrace_id AkTjua8CTo5ri1vH6MN6z4e)', transient: false, credentials: true });
    expect(metaErrorSummary(400, '{"error":{"message":"An access token is required to request this resource.","type":"OAuthException","code":104,"fbtrace_id":"AEQFCJ288tIY9TnoikEGZSq"}}')!.credentials).toBe(true);
    expect(adErrorSummary('x', 403, '{"errors":[]}')).toBeNull();        // a platform that gives no account has none
    // The message is bounded: a long answer cannot fill the row.
    expect(metaErrorSummary(400, body({ message: 'm'.repeat(5000), code: 100 }))!.message.length).toBeLessThan(260);
  });
  it('TikTok: CompletePayment, token in the Access-Token header', () => {
    const r = buildAdRequest('tiktok', purchase, { pixelCode: 'C0ABCDEFGH12345' }, 'TT')!;
    expect(r.headers['Access-Token']).toBe('TT');
    expect((r.body as any).event_source_id).toBe('C0ABCDEFGH12345');
    expect((r.body as any).data[0].event).toBe('CompletePayment');
  });
  it('Pinterest: checkout with string value; Snapchat: PURCHASE', () => {
    const p = buildAdRequest('pinterest', purchase, { adAccountId: '549755885175' }, 'P')!;
    expect((p.body as any).data[0].event_name).toBe('checkout');
    expect((p.body as any).data[0].custom_data.value).toBe('145000');
    const s = buildAdRequest('snapchat', purchase, { pixelId: '0a1b2c3d-0000-4000-8000-000000000000' }, 'S')!;
    expect((s.body as any).data[0].event_name).toBe('PURCHASE');
  });
  it('LinkedIn: purchase only, and only with a hashed email', () => {
    expect(buildAdRequest('linkedin', purchase, { conversionId: '123456' }, 'L')).not.toBeNull();
    expect(buildAdRequest('linkedin', { ...purchase, user_data: { ...purchase.user_data, hashed_email: undefined } }, { conversionId: '123456' }, 'L')).toBeNull();
    expect(buildAdRequest('linkedin', { ...purchase, event_name: 'view_item' }, { conversionId: '123456' }, 'L')).toBeNull();
  });
  it('an event a platform has no equivalent for is not sent (Pinterest has no begin_checkout)', () => {
    expect(buildAdRequest('pinterest', { ...purchase, event_name: 'begin_checkout' }, { adAccountId: '549755885175' }, 'P')).toBeNull();
  });
  it('platforms without an implemented API are listed with a reason, never built', () => {
    for (const k of ['spotify', 'sa360']) {
      const p = AD_PLATFORMS.find((x) => x.key === k)!;
      expect(p.unavailable).toBeTruthy();
      expect(buildAdRequest(k, purchase, {}, 't')).toBeNull();
    }
  });
});

describe('advertising destinations: complete before live, tokens write-only', () => {
  const mk = () => {
    const rows = new Map<string, any>();
    const repo = {
      list: async () => [...rows.values()], get: async (k: string) => rows.get(k) ?? null,
      save: async (k: string, p: any) => { const cur = rows.get(k) ?? { platform: k, enabled: false, config: {}, hasSecret: false, secretMask: null, sentCount: 0, failedCount: 0 };
        const next = { ...cur, enabled: p.enabled ?? cur.enabled, config: p.config ?? cur.config, hasSecret: p.secretEnc !== undefined ? !!p.secretEnc : cur.hasSecret, secretMask: p.secretMask ?? cur.secretMask };
        rows.set(k, next); return next; },
      active: async () => [],
    };
    const audit = { execute: async () => ({}) } as any;
    const cipher = { encrypt: (s: string) => `enc(${s})`, decrypt: (s: string) => s, mask: () => 'EAAB…wxyz' };
    return { uc: new AdDestinationUseCases(repo as any, AD_PLATFORMS as any, cipher, audit), rows };
  };
  it('refuses to switch on without ids and token; LIVE once complete; the token never comes back', async () => {
    const { uc, rows } = mk();
    expect(await uc.configure('u', 'meta', { enabled: true })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await uc.configure('u', 'meta', { config: { datasetId: 'abc' } })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    const r = await uc.configure('u', 'meta', { config: { datasetId: '1234567890123' }, secret: 'EAAB' + 'x'.repeat(40), enabled: true });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(rows.get('meta'))).not.toContain('EAABxxxx');
    const meta = (await uc.list()).find((p) => p.key === 'meta')!;
    expect(meta.state).toBe('LIVE');
    expect(await uc.recipients()).toEqual(['Meta (Facebook, Instagram, WhatsApp ads)']);
  });
  it('Meta domain verification: saved without a token, served publicly, and only as the plain code Meta issues', async () => {
    const { uc, rows } = mk();
    expect(await uc.siteVerification()).toEqual({ meta: null });
    // The code can be saved before the dataset or token exist: verifying the domain comes first.
    const code = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5';
    expect((await uc.configure('u', 'meta', { config: { domainVerification: code } })).ok).toBe(true);
    expect(await uc.siteVerification()).toEqual({ meta: code });
    expect((await uc.list()).find((p) => p.key === 'meta')!.state).toBe('NOT_CONFIGURED');   // it does not make Meta "configured"
    // Anything that is not the code is refused at the door, and never printed.
    for (const bad of ['<script>alert(1)</script>', 'short', 'has spaces in the middle of it xx', '"><meta'])
      expect(await uc.configure('u', 'meta', { config: { domainVerification: bad } }), bad).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    rows.set('meta', { ...rows.get('meta'), config: { domainVerification: '"><script>' } });
    expect(await uc.siteVerification()).toEqual({ meta: null });
    // The storefront checks again before printing, and prints it in the head of every page.
    const fs = require('node:fs'); const path = require('node:path');
    const read = (f: string) => fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
    expect(read('apps/web/src/lib/siteVerification.ts')).toContain('CODE.test(j.data.meta) ? j.data.meta : null');
    expect(read('apps/web/src/layouts/BaseLayout.astro')).toContain('{siteVerification.meta && <meta name="facebook-domain-verification" content={siteVerification.meta} />}');
  });
  it('an unavailable platform cannot be configured', async () => {
    const { uc } = mk();
    expect(await uc.configure('u', 'spotify', { enabled: true })).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' });
  });
});

describe('advertising: second-review fixes', () => {
  it('00-prefixed numbers normalise; TikTok gets the +E.164 hash, others digits-only', () => {
    expect(normalisePhoneUg('00256772123456')).toBe('256772123456');
    const t = buildAdRequest('tiktok', purchase, { pixelCode: 'C0ABCDEFGH12345' }, 'TT')!;
    expect((t.body as any).data[0].user.phone).toBe(hashPhonePlus('0772123456'));
    expect(hashPhonePlus('0772123456')).not.toBe(hashPhone('0772123456'));
  });
  it('API versions stay supported: LinkedIn header is two months back; Meta pinned to a current Graph version', () => {
    expect(linkedInVersion(new Date('2026-09-19T00:00:00Z'))).toBe('202607');
    expect(linkedInVersion(new Date('2027-01-05T00:00:00Z'))).toBe('202611');
    expect(META_GRAPH_VERSION).toBe('v25.0');
  });
  it('the pinned Meta version is not left to expire: a Marketing API version lives about a year', () => {
    expect(META_GRAPH_VERSION).toMatch(/^v\d{2}\.0$/);
    expect(META_GRAPH_VERSION_RELEASED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ageDays = (Date.now() - new Date(`${META_GRAPH_VERSION_RELEASED}T00:00:00Z`).getTime()) / 86_400_000;
    // THIS TEST FAILING IS THE REMINDER. Meta does not reject a retired version:
    // it serves the next usable one instead, so nothing else will say the pin
    // is stale. Read the Marketing API changelog for the endpoints this module uses
    // (/{dataset}/events, /dataset_quality, customaudiences, usersreplace,
    // insights), move META_GRAPH_VERSION to the newest version with no breaking
    // change for them, and set META_GRAPH_VERSION_RELEASED to its release date.
    expect(ageDays, `Meta Graph ${META_GRAPH_VERSION} was released ${Math.round(ageDays)} days ago; Marketing API versions expire about a year after release`).toBeLessThan(300);
    expect(ageDays).toBeGreaterThanOrEqual(0);
  });
  it('the notification worker never claims AD_CONVERSION rows (it would discard them as unroutable)', () => {
    const src = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase.ts'), 'utf8');
    expect(src).toMatch(/excludeEventTypes: \[[^\]]*'AD_CONVERSION'/);
  });
  it('ad fan-out runs before, and independently of, the GA4 send', () => {
    const src = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../apps/api/src/infrastructure/telemetry/TelemetryDispatchService.ts'), 'utf8');
    expect(src.indexOf('await fanOutAdConversions(event)')).toBeLessThan(src.indexOf('GTM_NOT_CONFIGURED: GA4_MEASUREMENT_ID'));
  });
});


import { oauth1Header, safePostbackUrl, hashEmailGoogle } from '../../apps/api/src/infrastructure/advertising/AdPlatforms';
import { isNonPublicAddress } from '../../apps/api/src/infrastructure/advertising/AdConversionDispatch';

describe('advertising: Google Ads, Microsoft, X and network postbacks', () => {
  const withClicks = { ...purchase, user_data: { ...purchase.user_data, gclid: 'Cj0KCQ', msclkid: 'ms123', twclid: 'tw123', network_click_id: 'abc-123', network_click_param: 'clickid', network_click_source: 'opera' } };
  it('Google Ads: uploadClickConversions with gclid, UTC datetime, value, order id and enhanced-conversion identifiers', () => {
    const r = buildAdRequest('google_ads', withClicks, { customerId: '1234567890', conversionActionId: '987654', apiVersion: 'v24' }, '{}')!;
    expect(r.url).toBe('https://googleads.googleapis.com/v24/customers/1234567890:uploadClickConversions');
    const c = (r.body as any).conversions[0];
    expect(c.gclid).toBe('Cj0KCQ');
    expect(c.conversionAction).toBe('customers/1234567890/conversionActions/987654');
    expect(c.conversionDateTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\+00:00$/);
    expect(c.userIdentifiers).toEqual([{ hashedEmail: purchase.user_data.hashed_email }, { hashedPhoneNumber: purchase.user_data.hashed_phone_plus }]);
    expect((r.body as any).partialFailure).toBe(true);
  });
  it('Google Ads: a 200 with partialFailureError is a failure', () => {
    const g = AD_PLATFORMS.find((p) => p.key === 'google_ads')!;
    expect(g.replyError!({ partialFailureError: { message: 'bad gclid' } })).toMatch(/bad gclid/);
    expect(g.replyError!({ results: [{}] })).toBeNull();
  });
  it('Microsoft: UET event with msclkid; X: identifiers incl twclid, signed OAuth1 header', () => {
    const m = buildAdRequest('microsoft_ads', withClicks, { tagId: '12345678' }, 'MS')!;
    expect(m.url).toBe('https://capi.uet.microsoft.com/v1/12345678/events');
    expect((m.body as any).data[0].userData.msclkid).toBe('ms123');
    const x = buildAdRequest('x', withClicks, { pixelId: 'o8z6j', purchaseEventId: 'tw-o8z6j-o8z6k' }, '{}')!;
    expect((x.body as any).conversions[0].identifiers[0]).toEqual({ twclid: 'tw123' });
    const h = oauth1Header('POST', x.url, { consumerKey: 'ck', consumerSecret: 'cs', accessToken: 'at', accessTokenSecret: 'ats' }, 'nonce', '1700000000');
    expect(h).toMatch(/^OAuth oauth_consumer_key="ck", oauth_nonce="nonce", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1700000000", oauth_token="at", oauth_version="1.0", oauth_signature="[A-Za-z0-9%]+"$/);
    // Deterministic: same inputs, same signature.
    expect(h).toBe(oauth1Header('POST', x.url, { consumerKey: 'ck', consumerSecret: 'cs', accessToken: 'at', accessTokenSecret: 'ats' }, 'nonce', '1700000000'));
  });
  it('postback: fills macros for a purchase from THAT network only; refuses unsafe URLs', () => {
    const r = buildAdRequest('opera', withClicks, { postbackUrl: 'https://track.opera.example.com/pb?cid={click_id}&v={value}&o={order_id}', clickParam: 'clickid', sourceMatch: 'opera' }, '')!;
    expect(r.method).toBe('GET');
    expect(r.url).toBe('https://track.opera.example.com/pb?cid=abc-123&v=145000&o=GP-1');
    expect(buildAdRequest('opera', withClicks, { postbackUrl: 'https://t.example.com/pb?c={click_id}', clickParam: 'click_id', sourceMatch: 'opera' }, '')).toBeNull();
    // Same parameter, another network's click: Boomplay's postback must NOT fire for Opera's sale.
    expect(buildAdRequest('boomplay', withClicks, { postbackUrl: 'https://pb.boomplay.example.com/c?id={click_id}', clickParam: 'clickid', sourceMatch: 'boomplay' }, '')).toBeNull();
    for (const bad of ['http://t.example.com/x', 'https://10.0.0.1/x', 'https://localhost/x', 'https://localhost./x', 'https://user:pw@t.example.com/x', 'https://t.example.com:8443/x', 'https://sgtm-production/x'])
      expect(safePostbackUrl(bad)).toBeNull();
  });
  it('no-token platforms can go live with ids alone; JSON credentials are checked on save', async () => {
    const rows = new Map<string, any>();
    const repo = { list: async () => [...rows.values()], get: async (k: string) => rows.get(k) ?? null, active: async () => [],
      save: async (k: string, p: any) => { const cur = rows.get(k) ?? { platform: k, enabled: false, config: {}, hasSecret: false, secretMask: null, sentCount: 0, failedCount: 0 };
        const next = { ...cur, enabled: p.enabled ?? cur.enabled, config: p.config ?? cur.config, hasSecret: p.secretEnc !== undefined ? !!p.secretEnc : cur.hasSecret }; rows.set(k, next); return next; } };
    const uc = new AdDestinationUseCases(repo as any, AD_PLATFORMS as any, { encrypt: (s: string) => s, decrypt: (s: string) => s, mask: () => 'm' }, { execute: async () => ({}) } as any);
    expect((await uc.configure('u', 'boomplay', { config: { postbackUrl: 'https://pb.boomplay.example.com/c?id={click_id}', clickParam: 'clickid', sourceMatch: 'boomplay' }, enabled: true })).ok).toBe(true);
    expect((await uc.list()).find((p) => p.key === 'boomplay')!.state).toBe('LIVE');
    const bad = await uc.configure('u', 'google_ads', { config: { customerId: '1234567890', conversionActionId: '987654', apiVersion: 'v24' }, secret: '{"developerToken":"x","clientId":"y"}' });
    expect(bad).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect((bad as any).message).toMatch(/missing: clientSecret, refreshToken/);
  });
});

describe('advertising: third-review fixes', () => {
  it('Google email normalisation drops gmail dots only; Google Ads uses it', () => {
    expect(hashEmailGoogle('J.Doe@Gmail.com')).toBe(hashEmail('jdoe@gmail.com'));
    expect(hashEmailGoogle('j.doe@company.ug')).toBe(hashEmail('j.doe@company.ug'));
  });
  it('X: the conversion is shaped as X documents it', () => {
    const x = buildAdRequest('x', { ...purchase, user_data: { ...purchase.user_data, twclid: 'tw123' } }, { pixelId: 'o8z6j', purchaseEventId: 'tw-o8z6j-o8z6k' }, '{}')!;
    expect(x.url).toBe('https://ads-api.x.com/12/measurement/conversions/o8z6j');
    const c = (x.body as any).conversions[0];
    // A string, as in X's own example ("20.00"); a JSON number is refused.
    expect(c.value).toBe('145000');
    expect(c.price_currency).toBe('UGX');
    expect(c.event_id).toBe('tw-o8z6j-o8z6k');
    expect(c.conversion_id).toBe(purchase.event_id);
    expect(c.number_items).toBe(1);
    expect(c.conversion_time).toBe(new Date(1790000000 * 1000).toISOString());
    expect(c.contents).toEqual([{ content_id: 'p1', content_name: 'Power bank', content_price: 145000, num_items: 1 }]);
    // Click id first, then hashed contact, then the IP and user agent as ONE pair.
    expect(c.identifiers).toEqual([
      { twclid: 'tw123' },
      { hashed_email: hashEmail('buyer@example.com') },
      { hashed_phone_number: hashPhonePlus('0772123456') },
      { ip_address: '41.84.203.125', user_agent: 'UA' },
    ]);
    expect(JSON.stringify(x.body)).not.toMatch(/buyer@example\.com|0772|256772/i);
  });
  it('X: IP and user agent never go alone, and never as half a pair', () => {
    const only = buildAdRequest('x', { ...purchase, user_data: { ip_address: '41.84.203.125', user_agent: 'UA' } }, { pixelId: 'o8z6j', purchaseEventId: 'tw-o8z6j-o8z6k' }, '{}');
    expect(only).toBeNull();
    const half = buildAdRequest('x', { ...purchase, user_data: { twclid: 'tw123', ip_address: '41.84.203.125' } }, { pixelId: 'o8z6j', purchaseEventId: 'tw-o8z6j-o8z6k' }, '{}')!;
    expect((half.body as any).conversions[0].identifiers).toEqual([{ twclid: 'tw123' }]);
  });
  it('X: accepts the purchase event id as Events Manager shows it or as the API documents it', () => {
    const x = AD_PLATFORMS.find((p) => p.key === 'x')!;
    const purchaseField = x.fields.find((f) => f.key === 'purchaseEventId')!;
    for (const ok of ['tw-o8z6j-o8z6k', 'ol288']) expect(purchaseField.pattern.test(ok), ok).toBe(true);
    for (const bad of ['', 'TW-O8Z6J', 'tw-o8z6j', 'https://x.com', 'abc']) expect(purchaseField.pattern.test(bad), bad).toBe(false);
  });
  it('X, default scope: X-click visitors only; each optimisation event needs its own event id', () => {
    const x = AD_PLATFORMS.find((p) => p.key === 'x')!;
    expect(x.fields.map((f) => f.key)).toEqual(['pixelId', 'purchaseEventId', 'sendScope', 'addToCartEventId', 'checkoutEventId', 'paymentInfoEventId', 'leadEventId', 'contentViewEventId']);
    // Every early signal the shop raises can reach X, and each is tied to one config field.
    expect(Object.keys(x.events).sort()).toEqual(['add_payment_info', 'add_to_cart', 'begin_checkout', 'generate_lead', 'purchase', 'view_item']);
    expect(Object.keys(X_EVENT_FIELD).sort()).toEqual(Object.keys(x.events).sort());
    const scope = x.fields.find((f) => f.key === 'sendScope')!;
    for (const ok of ['', 'x_clicks', 'all']) expect(scope.pattern.test(ok), ok).toBe(true);
    for (const bad of ['ALL', 'everything', 'x clicks']) expect(scope.pattern.test(bad), bad).toBe(false);
    expect(xSendScope({})).toBe('x_clicks');
    expect(xSendScope({ sendScope: 'x_clicks' })).toBe('x_clicks');
    expect(xSendScope({ sendScope: 'nonsense' })).toBe('x_clicks');
    expect(xSendScope(null)).toBe('x_clicks');
    // With only the purchase id configured, nothing but the purchase goes — even with an X click id on the event.
    const purchaseOnly = { pixelId: 'o8z6j', purchaseEventId: 'tw-o8z6j-o8z6k' };
    for (const name of ['add_to_cart', 'view_item', 'begin_checkout', 'add_payment_info', 'generate_lead']) {
      expect(buildAdRequest('x', { ...purchase, event_name: name, user_data: { twclid: 'tw123' } }, purchaseOnly, '{}'), name).toBeNull();
    }
    // With every id configured, each event goes under its own id — but only for an X-click visitor.
    const full = { ...purchaseOnly, addToCartEventId: 'tw-o8z6j-o8z6m', checkoutEventId: 'tw-o8z6j-o8z6n', paymentInfoEventId: 'tw-o8z6j-o8z6p', leadEventId: 'tw-o8z6j-o8z6q', contentViewEventId: 'tw-o8z6j-o8z6r' };
    for (const [name, field] of Object.entries(X_EVENT_FIELD)) {
      const clicked = buildAdRequest('x', { ...purchase, event_name: name, user_data: { twclid: 'tw123', hashed_email: hashEmail('buyer@example.com') } }, full, '{}')!;
      expect((clicked.body as any).conversions[0].event_id, name).toBe(full[field as keyof typeof full]);
      expect(buildAdRequest('x', { ...purchase, event_name: name, user_data: { hashed_email: hashEmail('buyer@example.com') } }, full, '{}'), `${name} without a click`).toBeNull();
    }
    // A lead carries no basket: X is not told value "0" or number_items 0, only the identifiers and the event.
    const lead = buildAdRequest('x', { ...purchase, event_name: 'generate_lead', ecommerce: undefined, user_data: { twclid: 'tw123' } }, full, '{}')!;
    const c = (lead.body as any).conversions[0];
    expect(c).not.toHaveProperty('value');
    expect(c).not.toHaveProperty('price_currency');
    expect(c).not.toHaveProperty('number_items');
    expect(c).not.toHaveProperty('contents');
    expect(c.identifiers).toEqual([{ twclid: 'tw123' }]);
  });
  it('X: an event with no ID is not accepted at all, and a skip names which of three reasons it was', () => {
    const cfg = { pixelId: 'o8z6j', purchaseEventId: 'tw-o8z6j-o8z6k', addToCartEventId: 'tw-o8z6j-o8z6m' };
    // Not queued: nothing could ever be sent for it.
    expect(adPlatformAccepts('x', 'add_to_cart', cfg)).toBe(true);
    expect(adPlatformAccepts('x', 'purchase', cfg)).toBe(true);
    expect(adPlatformAccepts('x', 'view_item', cfg)).toBe(false);
    expect(adPlatformAccepts('x', 'begin_checkout', cfg)).toBe(false);
    expect(adPlatformAccepts('x', 'refund', cfg)).toBe(false);            // not an event X maps
    // A platform with no per-event ID accepts whatever it maps.
    expect(adPlatformAccepts('meta', 'view_item', {})).toBe(true);
    expect(adPlatformAccepts('linkedin', 'view_item', {})).toBe(false);
    // The reason matches the builder's own three exits, in its order.
    const basket = { ...purchase, event_name: 'add_to_cart' };
    expect(adSkipReason('x', { ...basket, event_name: 'view_item', user_data: { twclid: 'tw1' } }, cfg)).toBe('NO_EVENT_ID');
    expect(adSkipReason('x', { ...basket, user_data: { hashed_email: hashEmail('buyer@example.com') } }, cfg)).toBe('NO_X_CLICK');
    expect(adSkipReason('x', { ...basket, user_data: { ip_address: '41.84.203.125', user_agent: 'UA' } }, { ...cfg, sendScope: 'all' })).toBe('NO_IDENTIFIER');
    for (const [e, c] of [
      [{ ...basket, event_name: 'view_item', user_data: { twclid: 'tw1' } }, cfg],
      [{ ...basket, user_data: { hashed_email: hashEmail('buyer@example.com') } }, cfg],
      [{ ...basket, user_data: { ip_address: '41.84.203.125', user_agent: 'UA' } }, { ...cfg, sendScope: 'all' }],
    ] as const) expect(buildAdRequest('x', e as never, c as never, '{}')).toBeNull();
    // Other platforms have one reason: nothing to match on.
    expect(adSkipReason('meta', basket, {})).toBe('NO_IDENTIFIER');
  });
  it('X, scope "all": every matchable purchase, and basket adds when an event id is set', () => {
    const cfg = { pixelId: 'o8z6j', purchaseEventId: 'tw-o8z6j-o8z6k', sendScope: 'all' };
    expect(xSendScope(cfg)).toBe('all');
    // No X click, but an email and phone X can match on.
    const byContact = buildAdRequest('x', purchase, cfg, '{}')!;
    expect((byContact.body as any).conversions[0].identifiers).toEqual([
      { hashed_email: hashEmail('buyer@example.com') },
      { hashed_phone_number: hashPhonePlus('0772123456') },
      { ip_address: '41.84.203.125', user_agent: 'UA' },
    ]);
    // Nothing X can match on: still nothing to send.
    expect(buildAdRequest('x', { ...purchase, user_data: { ip_address: '41.84.203.125', user_agent: 'UA' } }, cfg, '{}')).toBeNull();
    // Basket adds need their own event id.
    const basket = { ...purchase, event_name: 'add_to_cart', user_data: { twclid: 'tw123' } };
    expect(buildAdRequest('x', basket, cfg, '{}')).toBeNull();
    const withId = buildAdRequest('x', basket, { ...cfg, addToCartEventId: 'tw-o8z6j-o8z6m' }, '{}')!;
    expect((withId.body as any).conversions[0].event_id).toBe('tw-o8z6j-o8z6m');
  });
  it('X sends the +E.164 phone hash, alongside the click id', () => {
    const x = buildAdRequest('x', { ...purchase, user_data: { twclid: 'tw123', hashed_phone_plus: hashPhonePlus('0772123456') } }, { pixelId: 'o8z6j', purchaseEventId: 'tw-o8z6j-o8z6k' }, '{}')!;
    expect((x.body as any).conversions[0].identifiers).toEqual([{ twclid: 'tw123' }, { hashed_phone_number: hashPhonePlus('0772123456') }]);
  });
  it('X, default scope: only a conversion that came from an X click is sent', () => {
    const cfg = { pixelId: 'o8z6j', purchaseEventId: 'tw-o8z6j-o8z6k' };
    // A buyer we could match by email and phone, but who never clicked an X ad: nothing is sent.
    expect(buildAdRequest('x', purchase, cfg, '{}')).toBeNull();
    // A click from another network is not X's conversion either.
    expect(buildAdRequest('x', { ...purchase, user_data: { ...purchase.user_data, gclid: 'Cj0KCQ', ttclid: 'tt1' } }, cfg, '{}')).toBeNull();
    // With the X click id the purchase goes.
    expect(buildAdRequest('x', { ...purchase, user_data: { ...purchase.user_data, twclid: 'tw123' } }, cfg, '{}')).not.toBeNull();
  });
  it('X is reachable from exactly one place, so no second path can send without the scope rule', () => {
    const fs = require('node:fs'); const path = require('node:path');
    const hits: string[] = [];
    const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'dist') walk(p); }
      else if (/\.(ts|astro|mjs|js)$/.test(e.name) && /ads-api\.(x|twitter)\.com|api\.(x|twitter)\.com\/(1\.1|2)\//.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(path.resolve(__dirname, '../..'), p));
    } };
    walk(path.resolve(__dirname, '../../apps/api/src')); walk(path.resolve(__dirname, '../../apps/web/src'));
    expect(hits).toEqual(['apps/api/src/infrastructure/advertising/AdPlatforms.ts']);
  });
  it('postback hosts must resolve to public addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.18.0.3', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0'])
      expect(isNonPublicAddress(ip)).toBe(true);
    for (const ip of ['41.84.203.125', '8.8.8.8', '2606:4700::1']) expect(isNonPublicAddress(ip)).toBe(false);
  });
  it('the ad click is recorded on every page, last click wins, 30 days from the click', () => {
    const fs = require('node:fs'); const path = require('node:path');
    const layout = fs.readFileSync(path.resolve(__dirname, '../../apps/web/src/layouts/BaseLayout.astro'), 'utf8');
    expect(layout).toMatch(/recordAdClick\(\);/);
    const attr = fs.readFileSync(path.resolve(__dirname, '../../apps/web/src/lib/attribution.ts'), 'utf8');
    expect(attr).toMatch(/localStorage\.setItem\(CLICK_STORE, JSON\.stringify\(\{ ids, src:/);
    expect(attr).not.toMatch(/_fbp|_fbc/);
  });
});

