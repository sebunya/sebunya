import { describe, it, expect } from 'vitest';
import { ga4CollectHit } from '../../apps/api/src/infrastructure/telemetry/Ga4CollectHit';
import { gaSessionFromCookieHeader } from '../../apps/web/src/lib/gaSession';
import { decodeTelemetryPayload } from '../../apps/api/src/infrastructure/telemetry/TelemetryDispatchService';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ev = (over: any = {}) => ({ event_name: 'purchase', event_id: '11111111-1111-4111-8111-111111111111', event_time: 1, source: 'server',
  user_data: { fp_client_id: 'fp.1.x' }, ecommerce: { transaction_id: 'GP-1', value: 1000, currency: 'UGX' }, ...over });

describe('server-side GA4: sessions, refunds, consent', () => {
  it('reads GA4 session from both cookie formats, and nothing from junk', () => {
    expect(gaSessionFromCookieHeader('a=1; _ga_YVV0KLGMQJ=GS1.1.1726755000.3.1.1726755100.0.0.0; b=2')).toEqual({ gaSessionId: '1726755000', gaSessionNumber: 3 });
    expect(gaSessionFromCookieHeader('_ga_YVV0KLGMQJ=GS2.1.s1726755000$o7$g1$t1726755100$j60$l0$h0')).toEqual({ gaSessionId: '1726755000', gaSessionNumber: 7 });
    expect(gaSessionFromCookieHeader('_ga=GA1.1.1.2; _ga_X=garbage')).toBeNull();
    expect(gaSessionFromCookieHeader(null)).toBeNull();
  });
  it('a purchase with the visit session joins that session (sid/sct/seg)', () => {
    const p = ga4CollectHit(ev({ user_data: { fp_client_id: 'fp.1.x', ga_session_id: '1726755000', ga_session_number: 3 } }) as any, 'G-X')!;
    expect([p.get('sid'), p.get('sct'), p.get('seg')]).toEqual(['1726755000', '3', '1']);
  });
  it('without a session it sends none (GA would otherwise get a fabricated one)', () => {
    const p = ga4CollectHit(ev() as any, 'G-X')!;
    expect(p.get('sid')).toBeNull();
  });
  it('a refund carries the same transaction id and value', () => {
    const p = ga4CollectHit(ev({ event_name: 'refund' }) as any, 'G-X')!;
    expect([p.get('en'), p.get('ep.transaction_id'), p.get('epn.value')]).toEqual(['refund', 'GP-1', '1000']);
  });
  it('owner decision 2026-09-19: every ecommerce event is sent server-side; decoding covers both dispatch paths', () => {
    const src = readFileSync(resolve(__dirname, '../../apps/api/src/infrastructure/telemetry/TelemetryDispatchService.ts'), 'utf8');
    expect(src).not.toMatch(/if \(event\.source === 'browser'\) return;/);
    expect(src).toMatch(/const event = decodeTelemetryPayload\(raw\)/);
  });
  it('a double-encoded purchase decodes to its visitor (the worker path lost every purchase)', () => {
    const e = { event_name: 'purchase', source: 'server', user_data: { fp_client_id: 'fp.1.x' } };
    expect(decodeTelemetryPayload(JSON.stringify(e))).toEqual(e);
    expect(decodeTelemetryPayload(e)).toBe(e);
  });
  it('tracking is always on server-side; the browser choice governs cookies only; robots never load the tag', () => {
    const layout = readFileSync(resolve(__dirname, '../../apps/web/src/layouts/BaseLayout.astro'), 'utf8');
    expect(layout).toMatch(/analytics_storage: noCookies \? 'denied' : 'granted'/);
    expect(layout).not.toMatch(/globalPrivacyControl/);
    expect(layout.indexOf("gtag('consent', 'default'")).toBeLessThan(layout.indexOf("'/gtm.js?id='"));
    expect(layout).toMatch(/navigator\.webdriver === true \|\| \/HeadlessChrome\|Chrome-Lighthouse/);
    const mw = readFileSync(resolve(__dirname, '../../apps/web/src/middleware.ts'), 'utf8');
    expect(mw).toMatch(/context\.cookies\.set\('_fp_cid'/);
    expect(mw).not.toMatch(/sec-gpc/);
    const checkout = readFileSync(resolve(__dirname, '../../apps/web/src/pages/checkout.astro'), 'utf8');
    expect(checkout).toMatch(/headers\.get\('x-real-ip'\)/);
    const prefs = readFileSync(resolve(__dirname, '../../apps/web/src/pages/account/preferences.astro'), 'utf8');
    expect(prefs).toMatch(/c\?\.explicit === true/);
    const form = readFileSync(resolve(__dirname, '../../apps/web/src/components/preferences/PreferenceCentreForm.astro'), 'utf8');
    expect(form).toMatch(/Analytics cookies in your browser/);
    const privacy = readFileSync(resolve(__dirname, '../../apps/web/src/pages/privacy.astro'), 'utf8');
    expect(privacy).toMatch(/Google Analytics/);
    expect(privacy).toMatch(/IP address and browser/);
  });
  it('the shopper\'s real IP: Caddy trusts CF-Connecting-IP only from Cloudflare ranges', () => {
    const caddy = readFileSync(resolve(__dirname, '../../Caddyfile'), 'utf8');
    expect(caddy).toMatch(/trusted_proxies static 173\.245\.48\.0\/20/);
    expect(caddy).toMatch(/client_ip_headers CF-Connecting-IP/);
    expect(caddy).not.toMatch(/header_up X-Forwarded-For\s+\{remote_host\}/);
  });
  it('one purchase source only: settlement and explicit COD; the webhook no longer enqueues one', () => {
    const wh = readFileSync(resolve(__dirname, '../../apps/api/src/interfaces/http/routes/webhooks.ts'), 'utf8');
    expect(wh).not.toMatch(/enqueuePurchaseEvent\(/);
    const commerce = readFileSync(resolve(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'), 'utf8');
    expect(commerce).toMatch(/body\.paymentMethod === 'offline'/);
  });
});
