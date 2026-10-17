import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AudienceGateway, PlatformCredentials } from '../../apps/api/src/application/ports/Advertising';
import { AudienceSyncUseCases } from '../../apps/api/src/application/use-cases/advertising/AudienceSyncUseCases';
import { AdDestinationUseCases } from '../../apps/api/src/application/use-cases/advertising/AdDestinationUseCases';
import { AD_PLATFORMS } from '../../apps/api/src/infrastructure/advertising/AdPlatforms';
import { checkoutAbandoners, groupBuyers, segmentsFor } from '../../apps/api/src/domain/advertising/AudienceSegments';
import { ga4CollectHit, ga4ItemId } from '../../apps/api/src/infrastructure/telemetry/Ga4CollectHit';

/** Retargeting through Google Ads (owner, 2026-10-17). */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-17T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const order = (id: string, extra: any = {}) => ({ orderId: id, userId: null, email: null, phone: null, fpClientId: null, totalUgx: 95_000, purchasedAt: daysAgo(2), status: 'received', paymentStatus: 'unpaid', ...extra });

describe('checkout abandoners: gave their details, did not pay, have not bought since', () => {
  const orders = [
    order('a', { phone: '0772000001' }),                                                     // unpaid 2 days ago → in
    order('b', { phone: '0772000002', status: 'cancelled', paymentStatus: 'failed' }),         // payment failed → in
    order('c', { phone: '0772000003' }),                                                     // ...but bought since →
    order('c2', { phone: '+256 772 000 003', purchasedAt: daysAgo(1), status: 'processing', paymentStatus: 'paid' }), // out
    order('d', { phone: '0772000004', purchasedAt: daysAgo(1) }),                             // bought BEFORE →
    order('d0', { phone: '0772000004', purchasedAt: daysAgo(60), status: 'delivered', paymentStatus: 'paid' }), // still in
    order('e', { phone: '0772000005', purchasedAt: new Date(NOW.getTime() - 20 * 60_000) }),  // 20 minutes ago: may be paying → out
    order('f', { phone: '0772000006', purchasedAt: daysAgo(30) }),                            // outside 14 days → out
    order('g', { phone: '0772000007', status: 'processing' }),                                // accepted for delivery → not an abandoner
  ];
  it('selects exactly the right people, and never makes them buyers', () => {
    const buyers = groupBuyers(orders as any);
    expect(buyers.map((b) => b.orderIds.join())).toEqual(expect.arrayContaining(['c2', 'd0']));
    expect(buyers).toHaveLength(2);
    const out = checkoutAbandoners(orders as any, buyers, undefined, NOW);
    expect(out.map((p) => p.orderIds.join()).sort()).toEqual(['a', 'b', 'd']);
    expect(checkoutAbandoners(orders as any, buyers, { recentDays: 30, highValueMinUgx: null, highValueTopShare: 0.2, abandonDays: 45 }, NOW).map((p) => p.orderIds.join()).sort()).toEqual(['a', 'b', 'd', 'f']);
  });
  it('is offered on Google Ads only', () => {
    expect(segmentsFor('google_ads')).toContain('checkout_abandoners');
    expect(segmentsFor('meta')).not.toContain('checkout_abandoners');
    expect(segmentsFor('tiktok')).not.toContain('checkout_abandoners');
  });
  it('syncs to Google Ads with refusals left out, and never reaches Meta or the LinkedIn file', async () => {
    const uploads: Record<string, any[]> = {};
    const gateway: AudienceGateway = {
      createList: vi.fn(async (p: string, i: any) => ({ remoteId: `${p}-${i.name}`, uploaded: null })),
      replaceMembers: vi.fn(async (_p: string, id: string, members: any[]) => { uploads[id] = members; return { uploaded: members.length }; }),
      clearList: vi.fn(async () => ({ forget: true })),
    } as any;
    const remote = new Map<string, string>();
    const creds = (): PlatformCredentials => ({ config: { customerMatchTerms: 'accepted' }, secret: 's', destinationConfig: { customerId: '9161339749' }, destinationSecret: 'd', testMode: false } as any);
    const uc = new AudienceSyncUseCases(
      { buyerOrders: async () => [...orders, order('r', { phone: '0772000009', fpClientId: 'fp.refused' })] as any,
        refusedIdentities: async (_u: string[], fps: string[]) => ({ userIds: new Set<string>(), fpClientIds: new Set(fps.filter((f) => f === 'fp.refused')) }) },
      { remoteId: async (p: string, s: string) => remote.get(`${p}:${s}`) ?? null, saveRemoteId: async (p: string, s: string, id: string) => void remote.set(`${p}:${s}`, id),
        forgetRemoteId: async () => undefined, storedSegments: async () => [], recordRun: async () => undefined, recentRuns: async () => [] } as any,
      gateway, async (p: string) => ({ platform: p, row: { config: { segments: p === 'google_ads' ? 'checkout_abandoners' : '' } } } as any), async () => creds(), () => NOW,
    );
    const preview = await uc.preview();
    const g = preview.find((r) => r.platform === 'google_ads' && r.segment === 'checkout_abandoners')!;
    expect(g).toMatchObject({ inSegment: 4, excludedConsent: 1, eligible: 3 });
    expect(preview.some((r) => r.platform === 'meta' && r.segment === 'checkout_abandoners')).toBe(false);
    await uc.run('google_ads', 'SYNC', 'ADMIN', null);
    expect(Object.values(uploads)[0]).toHaveLength(3);
    await expect(uc.linkedinContactCsv('checkout_abandoners' as any)).rejects.toThrow(/Unknown list/);
  });
});

describe('the site lets Google use visits for ads only while Google Ads is Live with retargeting on', () => {
  const mk = (row: any) => new AdDestinationUseCases({ list: async () => (row ? [row] : []), get: async () => row, save: async () => row, active: async () => [] } as any, AD_PLATFORMS as any, null, { execute: async () => ({}) } as any);
  const live = { platform: 'google_ads', enabled: true, mode: 'live', config: { customerId: '9161339749', conversionActionId: '7001' }, hasSecret: true };
  it('LIVE → on; Test, switched off or not set up → off', async () => {
    expect((await mk(live).siteVerification()).googleAdsRemarketing).toBe(true);
    expect((await mk({ ...live, mode: 'test' }).siteVerification()).googleAdsRemarketing).toBe(false);
    expect((await mk({ ...live, config: { ...live.config, remarketing: 'off' } }).siteVerification()).googleAdsRemarketing).toBe(false);
    expect((await mk(null).siteVerification()).googleAdsRemarketing).toBe(false);
  });
  it('Consent Mode follows that switch; a shopper who turned advertising (or analytics cookies) off stays off', () => {
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    expect(layout).toContain('adSignals: siteVerification.googleAdsRemarketing');
    expect(layout).toContain("var ads = adSignals === true && !/(?:^|; )gp_ads=0/.test(document.cookie) ? 'granted' : 'denied';");
    expect(layout).toContain("ad_storage: noCookies ? 'denied' : ads, ad_user_data: ads, ad_personalization: ads,");
    expect(read('apps/web/src/pages/account/preferences.astro')).toMatch(/Astro\.cookies\.set\('gp_ads', advertising \? '1' : '0'/);
  });
  it('the cookies and privacy pages say so exactly when it is on', () => {
    expect(read('apps/web/src/pages/cookies.astro')).toMatch(/\{googleAdsRemarketing \? 'Google Ads cookies are also used[^']*' : 'No advertising cookies are used; advertising'\}/);
    expect(read('apps/web/src/pages/privacy.astro')).toMatch(/\{googleAdsRemarketing && <>\{" "\}Google also uses visits to this site/);
  });
});

describe('GA4 names products by SKU, as the Merchant Center feed does (dynamic retargeting)', () => {
  it('uses a real SKU, else the product id', () => {
    expect(ga4ItemId({ item_id: 'uuid-1', item_sku: 'GP-PB20' })).toBe('GP-PB20');
    expect(ga4ItemId({ item_id: 'uuid-1', item_sku: 'Needs Business Confirmation' })).toBe('uuid-1');
    expect(ga4ItemId({ item_id: 'uuid-1', item_sku: 'PENDING-01' })).toBe('uuid-1');
    expect(ga4ItemId({ item_id: 'uuid-1' })).toBe('uuid-1');
    const p = ga4CollectHit({ event_name: 'view_item', event_id: 'e', event_time: 1, source: 'browser', user_data: { fp_client_id: 'fp.1.a' }, ecommerce: { currency: 'UGX', items: [{ item_id: 'uuid-1', item_sku: 'GP-PB20', item_name: 'Power bank', quantity: 1 }] } } as any, 'G-X')!;
    expect(p.get('pr1')).toBe('idGP-PB20~nmPower bank~qt1');
  });
  it('the product page and checkout send the SKU with each item', () => {
    const pdp = read('apps/web/src/pages/products/[slug].astro');
    expect(pdp).toContain("data-product-sku={hasValidSku ? product.sku : ''}");
    expect(pdp.split('item_sku:      sku,').length - 1).toBe(2);
    expect(read('apps/web/src/pages/checkout.astro')).toContain('item_sku:  i.sku || undefined,');
  });
});
