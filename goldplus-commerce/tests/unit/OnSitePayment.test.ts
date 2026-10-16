import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mobileMoneyNetworkFor } from '../../packages/shared/src/phone/uganda';
import { isFramablePaymentUrl, onSitePaymentPath } from '../../apps/web/src/lib/payOnSite';

/** 2026-10-16: customers pay without leaving shopgoldplus.com, and are told which network to pick. */
describe('on-site payment', () => {
  it('names the network only for prefixes we are sure of', () => {
    expect(mobileMoneyNetworkFor('0705 004545')).toBe('Airtel');
    expect(mobileMoneyNetworkFor('+256740123456')).toBe('Airtel');
    expect(mobileMoneyNetworkFor('256751234567')).toBe('Airtel');
    expect(mobileMoneyNetworkFor('0776004545')).toBe('MTN');
    expect(mobileMoneyNetworkFor('0772123456')).toBe('MTN');
    expect(mobileMoneyNetworkFor('0781234567')).toBe('MTN');
    expect(mobileMoneyNetworkFor('0791234567')).toBeNull();
    expect(mobileMoneyNetworkFor('0414123456')).toBeNull();
    expect(mobileMoneyNetworkFor('not a number')).toBeNull();
  });
  it('frames only Pesapal, over https', () => {
    expect(isFramablePaymentUrl('https://pay.pesapal.com/iframe/PesapalIframe3/Index?OrderTrackingId=abc')).toBe(true);
    expect(isFramablePaymentUrl('https://cybqa.pesapal.com/pesapaliframe/x')).toBe(true);
    expect(isFramablePaymentUrl('http://pay.pesapal.com/x')).toBe(false);
    expect(isFramablePaymentUrl('https://pay.pesapal.com.evil.example/x')).toBe(false);
    expect(isFramablePaymentUrl('https://evil.example/?u=https://pay.pesapal.com')).toBe(false);
    expect(isFramablePaymentUrl('javascript:alert(1)')).toBe(false);
    expect(isFramablePaymentUrl(null)).toBe(false);
  });
  it('sends the customer to our page with the order and the network, or straight to the provider when it is not Pesapal', () => {
    const path = onSitePaymentPath({ redirectUrl: 'https://pay.pesapal.com/iframe/PesapalIframe3/Index?OrderTrackingId=abc', orderNumber: 'GP-202610-951E39E8', phone: '0705004545' });
    expect(path.startsWith('/checkout/pay?')).toBe(true);
    const q = new URLSearchParams(path.split('?')[1]);
    expect(q.get('ref')).toBe('GP-202610-951E39E8');
    expect(q.get('u')).toBe('https://pay.pesapal.com/iframe/PesapalIframe3/Index?OrderTrackingId=abc');
    expect(q.get('net')).toBe('Airtel');
    expect(onSitePaymentPath({ redirectUrl: 'https://other.example/pay', orderNumber: 'GP-1' })).toBe('https://other.example/pay');
  });
  it('every hand-off to Pesapal goes through our page, and the page refuses anything else', () => {
    const root = resolve(__dirname, '../..');
    const checkout = readFileSync(resolve(root, 'apps/web/src/pages/checkout.astro'), 'utf8');
    const track = readFileSync(resolve(root, 'apps/web/src/pages/track-order.astro'), 'utf8');
    const page = readFileSync(resolve(root, 'apps/web/src/pages/checkout/pay.astro'), 'utf8');
    expect(checkout).not.toMatch(/Astro\.redirect\(payRes\.data\.redirectUrl/);
    expect(track).not.toMatch(/Astro\.redirect\(pay\.data\.redirectUrl/);
    expect(checkout.match(/onSitePaymentPath\(/g)?.length).toBe(2);
    expect(track).toMatch(/onSitePaymentPath\(/);
    expect(page).toMatch(/if \(!isFramablePaymentUrl\(u\)\)/);
    expect(page).toMatch(/noindex,nofollow/);
    expect(page).toMatch(/Cache-Control', 'no-store'/);
  });
  it('the storefront CSP lets the frame load', () => {
    const caddy = readFileSync(resolve(__dirname, '../../Caddyfile'), 'utf8');
    expect(caddy).toMatch(/frame-src[^;]*https:\/\/pay\.pesapal\.com/);
  });
});
