import { describe, expect, it, vi, beforeEach } from 'vitest';
import { googleCampaignReport, googleTypeFromNetwork, googleTypeFromSpendChannel } from '../../apps/api/src/domain/advertising/GoogleCampaigns';
import { withVisitorClickIds, CLICK_ID_MAX_AGE_MS, GOOGLE_CLICK_ID_MAX_AGE_MS } from '../../apps/api/src/infrastructure/advertising/VisitorClickIds';

/** Google Ads attribution by campaign and type: YouTube, Search, Shopping, Performance Max (2026-10-17). */
describe('which kind of Google ad sold', () => {
  it('reads Google\'s ValueTrack network and the spend import\'s campaign type', () => {
    expect(['g', 's', 'd', 'ytv', 'yts', 'vp', 'x', 'zz', ''].map(googleTypeFromNetwork)).toEqual(['SEARCH', 'SEARCH', 'DISPLAY', 'YOUTUBE', 'YOUTUBE', 'YOUTUBE', 'PERFORMANCE_MAX', null, null]);
    expect(['paid_search', 'paid_shopping', 'paid_pmax', 'paid_video', 'paid_display', 'paid_other'].map(googleTypeFromSpendChannel)).toEqual(['SEARCH', 'SHOPPING', 'PERFORMANCE_MAX', 'DEMAND_GEN', 'DISPLAY', null]);
  });

  it('joins sales to campaigns by id; Google\'s campaign type wins; the network fills in; nothing is guessed', () => {
    const r = googleCampaignReport(
      [
        { orderId: 'o1', valueUgx: 145000, campaignId: '111', network: 'g' },   // campaign known from spend: PMax, not Search
        { orderId: 'o2', valueUgx: 55000, campaignId: '222', network: 'ytv' },  // no spend row: YouTube from the network
        { orderId: 'o3', valueUgx: 30000, campaignId: null, network: null },    // an older click: type not known
        { orderId: 'o4', valueUgx: 20000, campaignId: '333', network: null },   // a campaign id, nothing else: not known
      ],
      [
        { campaign: 'id:111', campaignLabel: 'PMax – power banks', channel: 'paid_pmax', currency: 'UGX', spendMinor: 50000, clicks: 40 },
        { campaign: 'id:111', campaignLabel: 'PMax – power banks', channel: 'paid_pmax', currency: 'UGX', spendMinor: 22500, clicks: 10 },
        { campaign: 'id:444', campaignLabel: 'YouTube – cables', channel: 'paid_video', currency: 'USD', spendMinor: 1234, clicks: 7 },
      ],
    );
    const by = (id: string | null) => r.campaigns.find((c) => c.campaignId === id)!;
    expect(by('111')).toMatchObject({ type: 'PERFORMANCE_MAX', typeFrom: 'campaign', orders: 1, revenueUgx: 145000, spend: [{ currency: 'UGX', spendMinor: 72500 }], clicks: 50, roas: 2 });
    expect(by('222')).toMatchObject({ type: 'YOUTUBE', typeFrom: 'network', orders: 1, spend: [], roas: null });
    expect(by(null)).toMatchObject({ type: 'UNKNOWN', typeFrom: 'unknown', orders: 1 });
    expect(by('333')).toMatchObject({ type: 'UNKNOWN', orders: 1 });
    // Spend in dollars and sales in shillings are not divided into a ROAS.
    expect(by('444')).toMatchObject({ type: 'DEMAND_GEN', orders: 0, roas: null, spend: [{ currency: 'USD', spendMinor: 1234 }] });
    expect(r.salesWithoutCampaign).toBe(1);
    expect(r.byType.map((t) => [t.label, t.orders, t.revenueUgx])).toEqual([['YouTube', 1, 55000], ['Performance Max', 1, 145000], ['YouTube & Demand Gen', 0, 0], ['Type not known', 2, 50000]]);
  });
});

describe('a Google click is remembered for Google\'s 90-day window; other networks keep 30', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const base = { event_name: 'view_item', event_id: 'e', event_time: 1, source: 'browser', user_data: { fp_client_id: 'fp.1.abc' } } as never;
  it('on browsing events sent from the server', async () => {
    const at = new Date(now - 60 * 86_400_000);
    const out = await withVisitorClickIds(base, async () => ({ gclid: 'Cj0K', twclid: 'tw', clickIdsAt: at }), now);
    expect((out as any).user_data.gclid).toBe('Cj0K');
    expect((out as any).user_data.twclid).toBeUndefined();
    expect(GOOGLE_CLICK_ID_MAX_AGE_MS).toBe(3 * CLICK_ID_MAX_AGE_MS);
    expect(await withVisitorClickIds(base, async () => ({ gclid: 'old', clickIdsAt: new Date(now - GOOGLE_CLICK_ID_MAX_AGE_MS - 1) }), now)).toBe(base);
  });
});

describe('the browser: a Google ad click is paid, names its campaign, and lasts 90 days', () => {
  const store = new Map<string, string>();
  const browser = (search: string, referrer = '') => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    vi.stubGlobal('location', { search, pathname: '/products/x', host: 'shopgoldplus.com' });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/128' });
    vi.stubGlobal('document', { referrer, cookie: '' });
  };
  beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); store.clear(); });

  it('a YouTube ad click is youtube / cpc (not organic social); a Search ad click google / cpc', async () => {
    browser('?gclid=Cj0KCQ&gad_source=1&gad_campaignid=2233445566&gp_net=ytv', 'https://www.youtube.com/');
    let a = await import('../../apps/web/src/lib/attribution');
    a.captureAttribution(); a.recordAdClick();
    expect(a.getCheckoutAttribution()).toMatchObject({ source: 'youtube', medium: 'cpc', clickIds: { gclid: 'Cj0KCQ', gad_campaignid: '2233445566', gad_source: '1', gp_net: 'ytv' } });
    // The identity stitch gets click ids only.
    expect(a.recentAdClickIds()).toEqual({ gclid: 'Cj0KCQ' });
    vi.resetModules(); store.clear();
    browser('?gclid=Cj0Search', 'https://www.google.co.ug/');
    a = await import('../../apps/web/src/lib/attribution');
    a.captureAttribution(); a.recordAdClick();
    expect(a.getCheckoutAttribution()).toMatchObject({ source: 'google', medium: 'cpc' });
  });

  it('campaign details ride only with a Google click; the Google click is kept 90 days, a Meta click 30', async () => {
    browser('?fbclid=IwAR2xQzAbC_dEf&gad_campaignid=999');
    let a = await import('../../apps/web/src/lib/attribution');
    a.captureAttribution(); a.recordAdClick();
    expect(a.getCheckoutAttribution()!.clickIds).not.toHaveProperty('gad_campaignid');
    expect(a.getCheckoutAttribution()).toMatchObject({ source: 'facebook', medium: 'paid_social' });
    const rec = JSON.parse(store.get('_gp_ad_click')!);
    store.set('_gp_ad_click', JSON.stringify({ ...rec, at: Date.now() - 45 * 864e5 }));
    expect(a.getCheckoutAttribution()!.clickIds).toEqual({});
    vi.resetModules(); store.clear();
    browser('?gclid=Cj0Old&gad_campaignid=111');
    a = await import('../../apps/web/src/lib/attribution');
    a.recordAdClick();
    const g = JSON.parse(store.get('_gp_ad_click')!);
    store.set('_gp_ad_click', JSON.stringify({ ...g, at: Date.now() - 80 * 864e5 }));
    expect(a.getCheckoutAttribution()!.clickIds).toMatchObject({ gclid: 'Cj0Old', gad_campaignid: '111' });
    store.set('_gp_ad_click', JSON.stringify({ ...g, at: Date.now() - 91 * 864e5 }));
    expect(a.getCheckoutAttribution()!.clickIds).toEqual({});
  });
});
