import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TIKTOK_REDIRECT_PATH, isTikTokAppId, isTikTokAuthCode, sameState, tiktokAuthoriseUrl, tiktokField } from '../../apps/web/src/lib/tiktokConnect';
import { HttpSpendGateway, dayWindows, tiktokSpendFacts } from '../../apps/api/src/infrastructure/advertising/AdvertisingGateways';
import { SPEND_PLATFORMS, apiPlatformOf } from '../../apps/api/src/application/use-cases/advertising/AdSpendUseCases';
import { capabilityDef } from '../../apps/api/src/application/use-cases/advertising/AdCapabilities';
import { spendFactErrors } from '../../apps/api/src/domain/advertising/SpendFacts';

describe('TikTok authorisation: the browser half', () => {
  it('the redirect address is exactly the one registered with TikTok', () => {
    expect(TIKTOK_REDIRECT_PATH).toBe('/admin/advertising/tiktok/callback');
    const u = new URL(tiktokAuthoriseUrl('7412345678901234567', 'state-abcdefghijklmnop', 'https://shopgoldplus.com'));
    expect(u.origin + u.pathname).toBe('https://business-api.tiktok.com/portal/auth');
    expect(u.searchParams.get('app_id')).toBe('7412345678901234567');
    expect(u.searchParams.get('state')).toBe('state-abcdefghijklmnop');
    expect(u.searchParams.get('redirect_uri')).toBe('https://shopgoldplus.com/admin/advertising/tiktok/callback');
  });
  it('only the state this browser was given is accepted; an empty, short or different one never is', () => {
    const s = 'a'.repeat(32);
    expect(sameState(s, s)).toBe(true);
    expect(sameState(s, 'b'.repeat(32))).toBe(false);
    expect(sameState(s, s + 'x')).toBe(false);
    expect(sameState('', '')).toBe(false);
    expect(sameState(null, s)).toBe(false);
    expect(sameState(s, undefined)).toBe(false);
    expect(sameState('short', 'short')).toBe(false);
    // Saved settings are read as the admin API lists them.
    expect(tiktokField({ fields: [{ key: 'appId', value: '7412345678901234567' }, { key: 'advertiserId', value: '' }] }, 'appId')).toBe('7412345678901234567');
    expect(tiktokField({ fields: [] }, 'appId')).toBe('');
    expect(tiktokField(null, 'appId')).toBe('');
    expect(isTikTokAppId('7412345678901234567')).toBe(true);
    expect(isTikTokAppId('abc')).toBe(false);
    expect(isTikTokAuthCode('abc_DEF-0123456789')).toBe(true);
    expect(isTikTokAuthCode('has space 0123456789')).toBe(false);
  });
  it('the callback page refuses a reply without the state, moves the code out of the address bar, and never renders the code, the secret or a token', () => {
    const page = readFileSync('apps/web/src/pages/admin/advertising/tiktok/callback.astro', 'utf8');
    expect(page).toContain('sameState(url.searchParams.get("state"), keptState)');
    expect(page).toContain('return Astro.redirect(TIKTOK_REDIRECT_PATH, 303)');
    expect(page).toContain('"Referrer-Policy", "no-referrer"');
    expect(page).toContain('"Cache-Control", "no-store"');
    expect(page).toContain('httpOnly: true');
    const markup = page.slice(page.indexOf('---', 3));
    expect(markup).not.toContain('{authCode}');
    expect(markup).not.toMatch(/value=\{(authCode|token)\}/);
    expect(markup).toContain('type="password"');
    const start = readFileSync('apps/web/src/pages/admin/advertising/tiktok/connect.astro', 'utf8');
    expect(start).toContain('randomBytes(24)');
    expect(start).toContain('httpOnly: true');
    for (const p of [page, start]) expect(p).toContain('/admin/login?returnTo=');   // an admin session is required
    // A backslash in an Astro attribute is eaten when the page is compiled ("\\d" became "d" and no ID could be submitted).
    for (const p of [page, start]) expect(p).not.toMatch(/pattern="[^"]*\\\\/);
  });
});

describe('TikTok spend import', () => {
  it('is a capability of its own that borrows the audiences token, and is part of the daily import', () => {
    expect(SPEND_PLATFORMS).toContain('tiktok');
    expect(apiPlatformOf('TikTok')).toBe('tiktok');
    expect(apiPlatformOf('tik tok ads')).toBe('tiktok');
    const def = capabilityDef('tiktok', 'spend')!;
    expect(def.secretFallback).toBe('audiences');
    expect(def.secretOptional).toBe(true);
    expect(def.fields.map((f) => f.key)).toEqual(['advertiserId']);
    expect(capabilityDef('tiktok', 'audiences')!.fields.find((f) => f.key === 'appId')!.optional).toBe(true);
  });
  it('report rows become facts in the account currency; an unknown count stays unknown; a row without a day is dropped', () => {
    const facts = tiktokSpendFacts([
      { dimensions: { campaign_id: '1800000000000001', stat_time_day: '2026-09-20 00:00:00' }, metrics: { campaign_name: 'Launch', spend: '186.78', impressions: '12000', clicks: '340' } },
      { dimensions: { campaign_id: '1800000000000002', stat_time_day: '2026-09-21 00:00:00' }, metrics: { spend: '0.00', impressions: '', clicks: null } },
      { dimensions: { campaign_id: '1800000000000003' }, metrics: { spend: '5' } },
    ], '7300000000000000001', 'usd');
    expect(facts).toHaveLength(2);
    expect(facts[0]).toEqual({ spendDate: '2026-09-20', channel: 'paid_social', platform: 'TikTok', account: '7300000000000000001', campaign: 'id:1800000000000001', campaignLabel: 'Launch',
      currency: 'USD', spendMinor: 18678, clicks: 340, impressions: 12000, source: 'tiktok_marketing_api' });
    expect(facts[1]).toMatchObject({ spendMinor: 0, clicks: null, impressions: null, campaignLabel: null });
    for (const f of facts) expect(spendFactErrors(f, new Date('2026-10-02T00:00:00Z'))).toEqual([]);
    // Spend that is not a number is not turned into a number.
    const bad = tiktokSpendFacts([{ dimensions: { campaign_id: '1', stat_time_day: '2026-09-20 00:00:00' }, metrics: { spend: 'n/a' } }], '7300000000000000001', 'USD');
    expect(spendFactErrors(bad[0], new Date('2026-10-02T00:00:00Z')).length).toBeGreaterThan(0);
  });
  it('a range is read in windows of at most 30 days that cover it exactly', () => {
    expect(dayWindows('2026-09-01', '2026-09-07')).toEqual([{ from: '2026-09-01', to: '2026-09-07' }]);
    expect(dayWindows('2026-07-01', '2026-09-28')).toEqual([{ from: '2026-07-01', to: '2026-07-30' }, { from: '2026-07-31', to: '2026-08-29' }, { from: '2026-08-30', to: '2026-09-28' }]);
    expect(dayWindows('2026-09-05', '2026-09-05')).toEqual([{ from: '2026-09-05', to: '2026-09-05' }]);
  });
  const creds = { config: { advertiserId: '7300000000000000001' }, secret: 'TT_MARKETING_TOKEN_0123456789', destinationConfig: {}, destinationSecret: '', testMode: false };
  it('asks TikTok for the currency, then the campaign-by-day report, page by page, with the token in the header only', async () => {
    const seen: Array<{ url: URL; headers: any }> = [];
    const fetchStub = (async (url: string, init: any) => {
      const u = new URL(String(url)); seen.push({ url: u, headers: init.headers });
      if (u.pathname.endsWith('/advertiser/info/')) return new Response(JSON.stringify({ code: 0, data: { list: [{ currency: 'USD' }] } }), { status: 200 });
      const page = Number(u.searchParams.get('page'));
      return new Response(JSON.stringify({ code: 0, data: { page_info: { page, total_page: 2 }, list: [{ dimensions: { campaign_id: `c${page}`, stat_time_day: '2026-09-20 00:00:00' }, metrics: { campaign_name: `Camp ${page}`, spend: '10.50', impressions: '100', clicks: '5' } }] } }), { status: 200 });
    }) as never;
    const facts = await new HttpSpendGateway(fetchStub).fetchDaily('tiktok', '2026-09-20', '2026-09-26', creds as never);
    expect(facts.map((f) => f.campaign)).toEqual(['id:c1', 'id:c2']);
    expect(facts[0]).toMatchObject({ currency: 'USD', spendMinor: 1050, platform: 'TikTok' });
    expect(seen).toHaveLength(3);
    for (const s of seen) { expect(s.url.origin).toBe('https://business-api.tiktok.com'); expect(s.headers['Access-Token']).toBe(creds.secret); expect(s.url.href).not.toContain(creds.secret); }
    const report = seen[1].url.searchParams;
    expect(seen[1].url.pathname).toBe('/open_api/v1.3/report/integrated/get/');
    expect(Object.fromEntries(report)).toMatchObject({ advertiser_id: '7300000000000000001', report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN', start_date: '2026-09-20', end_date: '2026-09-26', page_size: '1000' });
    expect(JSON.parse(report.get('dimensions')!)).toEqual(['campaign_id', 'stat_time_day']);
    expect(JSON.parse(report.get('metrics')!)).toEqual(['campaign_name', 'spend', 'impressions', 'clicks']);
  });
  it('no currency from TikTok means nothing is imported; a refusal is TikTok\'s message without the token', async () => {
    const noCurrency = (async () => new Response(JSON.stringify({ code: 0, data: { list: [{}] } }), { status: 200 })) as never;
    await expect(new HttpSpendGateway(noCurrency).fetchDaily('tiktok', '2026-09-20', '2026-09-26', creds as never)).rejects.toThrow(/currency/);
    const refused = (async () => new Response(JSON.stringify({ code: 40001, message: `No permission for token ${creds.secret}` }), { status: 200 })) as never;
    const err = await new HttpSpendGateway(refused).fetchDaily('tiktok', '2026-09-20', '2026-09-26', creds as never).catch((e) => e as Error);
    expect(err.message).toContain('TikTok code 40001');
    expect(err.message).not.toContain(creds.secret);
  });
});
