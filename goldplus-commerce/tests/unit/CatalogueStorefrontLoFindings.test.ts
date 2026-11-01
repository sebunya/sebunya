import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Catalogue / PDP / search sweep (P3): the storefront says one price and one
 * truth on every surface, a gone product says so in words, and telemetry that
 * feeds owner decisions counts people, once.
 */

const calls = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../apps/api/src/infrastructure/Registry', () => ({ Registry: { getInstance: () => ({
  productRepo: { findPublicViewList: calls.list },
}) } }));
import app from '../../apps/api/src/interfaces/http/app';
import { BatteryFinderUseCases } from '../../apps/api/src/application/use-cases/batteries/BatteryFinderUseCases';
import { CARD_SIZES } from '../../apps/web/src/lib/imageSrcset';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const pdp = read('apps/web/src/pages/products/[slug].astro');
const hub = read('apps/web/src/pages/[hub]/[...child].astro');
const shop = read('apps/web/src/pages/shop.astro');
const compare = read('apps/web/src/pages/compare.astro');
const PID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('GET /products?ids= accepts product ids only', () => {
  beforeEach(() => { calls.list.mockReset(); calls.list.mockResolvedValue([]); });

  it('a non-UUID id is an empty list, not a 500, and never the whole catalogue', async () => {
    const res = await app.request('/products?ids=abc');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: [] });
    expect(calls.list).not.toHaveBeenCalled();
  });

  it('valid ids pass through, invalid ones beside them are dropped', async () => {
    const res = await app.request(`/products?ids=${PID},abc,1;drop`);
    expect(res.status).toBe(200);
    expect(calls.list).toHaveBeenCalledWith(expect.objectContaining({ ids: [PID] }));
  });

  it('/compare filters ids, quotes the charged price and names what a button removes', () => {
    expect(compare).toMatch(/filter\(\(id\) => UUID\.test\(id\)\)/);
    expect(compare).toContain('salePriceUgx(retail, discount.percentBps, effectiveFloorUgx(discount.priceFloorUgx, item.floorPriceUgx, retail))');
    expect(compare).toContain('sale !== null && sale < retail');
    expect(compare).not.toContain('Pending review');
    expect(compare).toContain('aria-label={`Remove ${item.name} from comparison`}');
  });
});

describe('the PDP resolving ?device= is not a second demand event', () => {
  function finder() {
    const recordEvent = vi.fn(async () => undefined);
    const repo = {
      getConfig: async () => null,
      deviceBySlug: async () => ({ id: 'd1', slug: 'nokia-1100', label: 'Nokia 1100' }),
      fitsForDevice: async () => [],
      recordEvent,
    };
    return { uc: new BatteryFinderUseCases(repo as never, {} as never, {} as never, 'pepper'), recordEvent };
  }

  it('a finder choice records DEVICE_SELECTED; a record=false lookup does not', async () => {
    const chosen = finder();
    await chosen.uc.device('nokia-1100', null);
    expect(chosen.recordEvent).toHaveBeenCalledTimes(1);
    const lookup = finder();
    const out = await lookup.uc.device('nokia-1100', null, false);
    expect(out.device.slug).toBe('nokia-1100');
    expect(lookup.recordEvent).not.toHaveBeenCalled();
  });

  it('the route reads ?record=0 and the PDP sends it', () => {
    expect(read('apps/api/src/interfaces/http/routes/batteries.ts')).toContain("c.req.query('record') !== '0'");
    expect(pdp).toContain('/finder/devices/${encodeURIComponent(selectedDeviceParam)}?record=0');
  });
});

describe('PDP render path', () => {
  it('a search click is counted for people only and never awaited', () => {
    const block = pdp.slice(pdp.indexOf('if (searchQuery && Number.isInteger(searchRank)'), pdp.indexOf("type: 'click'"));
    expect(block).toContain("isLikelyHuman(Astro.request.headers.get('user-agent'))");
    expect(block).not.toMatch(/await fetch\(/);
  });

  it('independent reads start together after the lifecycle decision, and the whole catalogue is not fetched', () => {
    expect(pdp).not.toContain('fetchApprovedCatalogue');
    const lifecycle = pdp.indexOf('/seo/product-lifecycle');
    for (const started of ['const taxonomyP = settle(getTaxonomy())', 'const discountP = settle(getStorefrontDiscount())', 'const loyaltyRateP', 'const compatibilityP', 'const batteryP = publicBattery', 'const fallbackCandidatesP']) {
      expect(pdp.indexOf(started), started).toBeGreaterThan(lifecycle);
      expect(pdp.indexOf(started), started).toBeLessThan(pdp.indexOf('const hasValidSku'));
    }
    expect(pdp).toContain('category=${encodeURIComponent(cat.slug)}&limit=12');
    // Nothing downstream fetches in sequence again.
    const frontmatter = pdp.slice(pdp.indexOf('const hasValidSku'), pdp.indexOf('\n---', 10));
    expect(frontmatter).not.toMatch(/await fetch\(|await getTaxonomy\(|await getBusinessInfo\(|await getStorefrontDiscount\(|await publicBattery/);
  });

  it('a GONE_410 decision answers a real page with a way on, not an empty redirect body', () => {
    expect(pdp).not.toMatch(/return Astro\.redirect\('\/404', 410\)/);
    const gone = pdp.slice(pdp.indexOf('if (o.httpStatus === 410)'), pdp.indexOf('lifecycleNotice = o.notice'));
    expect(gone).toContain('status: 410');
    expect(gone).toContain('is no longer available');
    expect(gone).toContain('href="/shop"');
    expect(gone).toContain('noindex');
  });
});

describe('hub pages and /shop', () => {
  it('the ItemList offer is the price the card shows during a campaign', () => {
    expect(hub).toContain('offerPriceUgx(p.retailPriceUgx, hubCampaignRunning ? salePriceUgx(p.retailPriceUgx, hubDiscount.percentBps, effectiveFloorUgx(hubDiscount.priceFloorUgx, p.floorPriceUgx, p.retailPriceUgx)) : null)');
    expect(hub).not.toMatch(/price: p\.retailPriceUgx,/);
  });

  it('a hub renders its first 24 cards and hands the rest to the shop', () => {
    expect(hub).toContain('const HUB_CARD_LIMIT = 24;');
    expect(hub).toContain('{shownProducts.map((product, index) =>');
    expect(hub).toContain('See all {products.length} in the shop');
  });

  it('a partial catalogue is never shown as complete, and records no zero-result demand', () => {
    expect(shop).toContain('fetchApprovedCatalogueWithStatus(apiBase)');
    expect(shop).toContain('rawProducts.length > 0 && !catalogueFetch.complete');
    expect(shop).toMatch(/if \(search && !cataloguePartial && isLikelyHuman/);
    expect(shop).toContain('const zeroResults = !catalogueNotice && !cataloguePartial && products.length === 0;');
  });
});

describe('card image sizes match the two-column phone and tablet grid', () => {
  it('half the viewport up to 1023px, then a ~300px column', () => {
    expect(CARD_SIZES).toBe('(max-width: 1023px) 50vw, 320px');
    expect(CARD_SIZES).not.toContain('33vw');
  });
});
