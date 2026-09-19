import { describe, it, expect } from 'vitest';
import { AD_PLATFORMS, buildAdRequest, hashEmail, hashPhone, hashPhonePlus, normalisePhoneUg, linkedInVersion, META_GRAPH_VERSION } from '../../apps/api/src/infrastructure/advertising/AdPlatforms';
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
  it('Meta: Purchase to the dataset with hashed ids, IP/UA, value and order id; the token only in the URL', () => {
    const r = buildAdRequest('meta', purchase, { datasetId: '1234567890123' }, 'TOKEN_x')!;
    expect(r.url).toBe('https://graph.facebook.com/v23.0/1234567890123/events?access_token=TOKEN_x');
    const d = (r.body as any).data[0];
    expect([d.event_name, d.action_source, d.event_id, d.custom_data.value, d.custom_data.order_id, d.custom_data.currency]).toEqual(['Purchase', 'website', purchase.event_id, 145000, 'GP-1', 'UGX']);
    expect(d.user_data.em[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(d.user_data.client_ip_address).toBe('41.84.203.125');
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
    expect(META_GRAPH_VERSION).toBe('v23.0');
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
  it('X sends the +E.164 phone hash', () => {
    const x = buildAdRequest('x', { ...purchase, user_data: { hashed_phone_plus: hashPhonePlus('0772123456') } }, { pixelId: 'o8z6j', purchaseEventId: 'tw-o8z6j-o8z6k' }, '{}')!;
    expect((x.body as any).conversions[0].identifiers).toEqual([{ hashed_phone_number: hashPhonePlus('0772123456') }]);
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

