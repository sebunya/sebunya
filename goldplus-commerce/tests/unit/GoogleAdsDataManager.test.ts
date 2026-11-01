import { generateKeyPairSync, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAdRequest, googleAdsEvent, googleServiceAccountAssertion, parseGoogleCredentials, googleAdsApiHeaders } from '../../apps/api/src/infrastructure/advertising/AdPlatforms';
import { googleRestatedValue, toCanonical } from '../../apps/api/src/infrastructure/measurement/DeliveryService';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const cfg = { customerId: '1234567890', conversionActionId: '987654' };
const purchase: any = {
  event_name: 'purchase', event_id: 'e-1', event_time: 1790000000, source: 'server',
  user_data: { ip_address: '41.84.203.125', user_agent: 'UA', customer_type: 'NEW' },
  ecommerce: { transaction_id: 'GP-1', value: 145000, currency: 'UGX', items: [{ item_id: 'p1', item_sku: 'GP-PB20', price: 145000, quantity: 1 }, { item_id: 'p2', price: 5000, quantity: 2 }] },
};

describe('Google Ads through the Data Manager API (2026-10-16)', () => {
  it('names the buyer new or returning, and the products by their Merchant Center id (SKU)', () => {
    const b = buildAdRequest('google_ads', purchase, { ...cfg, merchantCenterId: '5551234' }, '{}')!.body as any;
    const ev = b.events[0];
    expect(ev.userProperties).toEqual({ customerType: 'NEW' });
    expect(ev.cartData).toEqual({ merchantId: '5551234', items: [{ merchantProductId: 'GP-PB20', quantity: '1', unitPrice: 145000 }] });
  });

  it('matches on the visitor IP when there is no click id or contact; with nothing at all, sends nothing', () => {
    const ipOnly = buildAdRequest('google_ads', purchase, cfg, '{}')!.body as any;
    expect(ipOnly.events[0].adIdentifiers).toBeUndefined();
    expect(ipOnly.events[0].eventDeviceInfo.ipAddress).toBe('41.84.203.125');
    expect(buildAdRequest('google_ads', { ...purchase, user_data: {} }, cfg, '{}')).toBeNull();
    expect(googleAdsEvent({ transactionId: 'x', eventTimeSec: 1, source: 'WEB' })).toBeNull();
  });

  it('Test mode validates without recording; a manager account is the login account', () => {
    const b = buildAdRequest('google_ads', purchase, { ...cfg, _test: '1', loginCustomerId: '1112223334' }, '{}')!.body as any;
    expect(b.validateOnly).toBe(true);
    expect(b.destinations[0].loginAccount).toEqual({ accountType: 'GOOGLE_ADS', accountId: '1112223334' });
  });

  it('accepts a pasted service-account key file and signs a valid RS256 assertion for the Data Manager scope', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const c = parseGoogleCredentials(JSON.stringify({ type: 'service_account', client_email: 'ads@p.iam.gserviceaccount.com', private_key: pem }));
    expect(c.kind).toBe('service_account');
    const jwt = googleServiceAccountAssertion('ads@p.iam.gserviceaccount.com', pem, 'https://www.googleapis.com/auth/datamanager', 1790000000);
    const [h, p, sig] = jwt.split('.');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(claims).toEqual({ iss: 'ads@p.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/datamanager', aud: 'https://oauth2.googleapis.com/token', iat: 1790000000, exp: 1790003600 });
    expect(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(true);
    expect(parseGoogleCredentials(JSON.stringify({ clientId: 'a', clientSecret: 'b', refreshToken: 'c' })).kind).toBe('oauth');
    expect(() => parseGoogleCredentials('{"clientId":"a"}')).toThrow(/service-account key file/);
  });

  it('only the spend import needs a developer token, and says so', async () => {
    await expect(googleAdsApiHeaders(JSON.stringify({ clientId: 'a', clientSecret: 'b', refreshToken: 'c' }))).rejects.toThrow(/developer token/);
  });

  it('a refund restates the purchase at the value kept; a full refund restates it to 0', () => {
    expect(googleRestatedValue(145000, [45000], false)).toBe(100000);
    expect(googleRestatedValue(145000, [100000, 60000], false)).toBe(0);
    expect(googleRestatedValue(145000, [10000], true)).toBe(0);
    const routing = read('apps/api/src/infrastructure/measurement/DeliveryService.ts');
    expect(routing).toMatch(/if \(gads\?\.state === 'ACCEPTED'\) sinks\.push\(\{ sink: 'ad:google_ads:restate'/);
    expect(routing).toMatch(/if \(moneyRefunded && gads\?\.state === 'ACCEPTED'\) sinks\.push\(\{ sink: 'ad:google_ads:restate'/);
  });

  it('the purchase wire event carries the SKU; the identity says new or returning', () => {
    const c = toCanonical({ event_id: 'e', event_name: 'order_confirmed', occurred_at: '2026-10-16T10:00:00Z', payload: { orderNumber: 'GP-1', netMerchandiseUGX: '1000', items: [{ productId: 'p1', sku: 'GP-L01', name: 'Cable', netLineUGX: '1000', quantity: 1 }] } }, 'ad:google_ads:purchase', { customer_type: 'RETURNING' });
    expect((c.ecommerce!.items![0] as any).item_sku).toBe('GP-L01');
    expect((c.user_data as any).customer_type).toBe('RETURNING');
    expect(read('apps/api/src/infrastructure/measurement/DeliveryService.ts')).toMatch(/customer_type: earlier \? 'RETURNING' : 'NEW'/);
  });
});
