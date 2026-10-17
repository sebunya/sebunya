import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { googleCampaignReport, spendInUgx } from '../../apps/api/src/domain/advertising/GoogleCampaigns';
import { setDeviceAdvertising } from '../../apps/web/src/lib/deviceAdChoice';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('ROAS for a dollar-billed Google Ads account (2026-10-17)', () => {
  const sales = [{ orderId: 'o1', valueUgx: 370000, campaignId: '111', network: null }];
  const spend = [{ campaign: 'id:111', campaignLabel: 'PMax', channel: 'paid_pmax', currency: 'USD', spendMinor: 5000, clicks: 10 }]; // USD 50.00
  it('without a rate: no number is invented', () => {
    const r = googleCampaignReport(sales, spend);
    expect(r.ugxPerUsd).toBeNull();
    expect(r.campaigns[0].roas).toBeNull();
  });
  it('with the card\'s rate: sales ÷ (dollars × rate), and the rate is stated', () => {
    const r = googleCampaignReport(sales, spend, 3700);
    expect(r.ugxPerUsd).toBe(3700);
    expect(r.campaigns[0].roas).toBe(2); // 370,000 ÷ (50 × 3,700 = 185,000)
    expect(r.byType.find((t) => t.type === 'PERFORMANCE_MAX')!.roas).toBe(2);
  });
  it('an unusable rate is ignored; another currency is never guessed', () => {
    expect(googleCampaignReport(sales, spend, 37).ugxPerUsd).toBeNull();
    expect(spendInUgx([{ currency: 'EUR', spendMinor: 100 }], 3700)).toBeNull();
    expect(spendInUgx([{ currency: 'UGX', spendMinor: 1000 }, { currency: 'USD', spendMinor: 100 }], 3700)).toBe(4700);
  });
  it('the rate lives on the Google Ads card and is never sent to Google', () => {
    expect(read('apps/api/src/infrastructure/advertising/AdPlatforms.ts')).toMatch(/key: 'ugxPerUsd', label: 'Shillings per US dollar \(for ROAS in reports\)'/);
    expect(read('apps/api/src/infrastructure/advertising/AdvertisingWiring.ts')).toMatch(/destRepo\.get\('google_ads'\)\)\?\.config\?\.ugxPerUsd/);
  });
});

describe('advertising on this device, for guests too (2026-10-17)', () => {
  const calls: Array<{ url: string; auth: string | null; body: any }> = [];
  const fake = (status = 200) => (async (url: string, init: any) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization ?? null, body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ success: true, data: { analytics: true, personalization: false, advertising: false } }), { status });
  }) as unknown as typeof fetch;
  const fp = 'fp.1790000000000.abc-def';
  it('off: records the device refusal first, then the account\'s when signed in', async () => {
    calls.length = 0;
    expect(await setDeviceAdvertising(false, { apiBase: 'http://api', fpClientId: fp, sessionToken: 'tok', fetchImpl: fake() })).toEqual({ ok: true });
    expect(calls.map((c) => [c.url, c.auth])).toEqual([['http://api/consent/withdraw', null], ['http://api/consent/withdraw', 'Bearer tok']]);
    expect(calls[0].body).toMatchObject({ fp_client_id: fp, purposes: ['advertising'] });
  });
  it('on: an explicit advertising grant that keeps the other choices', async () => {
    calls.length = 0;
    expect(await setDeviceAdvertising(true, { apiBase: 'http://api', fpClientId: fp, sessionToken: null, fetchImpl: fake() })).toEqual({ ok: true });
    const signal = calls.find((c) => c.url.endsWith('/consent/signal'))!;
    expect(signal.body).toMatchObject({ fp_client_id: fp, grant_type: 'explicit', purposes: { essential: true, analytics: true, personalization: false, advertising: true } });
  });
  it('a failed save says so and the page keeps the old choice (the cookie is set only on success)', async () => {
    expect((await setDeviceAdvertising(false, { apiBase: 'http://api', fpClientId: fp, sessionToken: null, fetchImpl: fake(500) })).ok).toBe(false);
    expect((await setDeviceAdvertising(false, { apiBase: 'http://api', fpClientId: '', sessionToken: null, fetchImpl: fake() })).ok).toBe(false);
    const page = read('apps/web/src/pages/cookies.astro');
    expect(page).toMatch(/if \(r\.ok\) \{\s*Astro\.cookies\.set\('gp_ads'/);
    expect(page).toContain("Astro.response.headers.set('Cache-Control', 'private, no-store')");
    expect(page).toContain('Advertising on this device');
    expect(page).not.toContain('signed-in customers can switch advertising off in the Preference Centre. Advertising');
  });
});
