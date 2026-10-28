import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isDeviceSlug, phoneBatteryPath, phonePageDescription, phonePageH1, phonePageIndexable, phonePageItemListJsonLd, phonePageTitle, phoneGuides,
} from '../../apps/web/src/lib/phoneBatteryPage';
import { BatteryFinderUseCases } from '../../apps/api/src/application/use-cases/batteries/BatteryFinderUseCases';

/**
 * Organic pilot 2026-10-28 (docs/growth/README.md): one indexable page per
 * phone with a battery to buy. These pin the rules a search engine and a
 * customer both depend on: the page says only what the catalogue holds, it is
 * indexable only while there is something to sell, and every surface that
 * lists phones reads the same fit index.
 */
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

const device = { id: 'd1', slug: 'tecno-spark-7-kf6', brandName: 'Tecno', seriesName: 'Spark', model: 'Spark 7', modelNumber: 'KF6', variant: null, label: 'Tecno Spark 7 (KF6)', releaseYear: 2021, verifiedFits: 0, listedFits: 1 };
const result = {
  productId: '11111111-1111-4111-8111-111111111111', slug: 'bl-49ft', name: 'GoldPlus BL-49FT battery', canonicalCode: 'BL-49FT', imageUrl: '/img/bl-49ft.jpg',
  priceUgx: 55_000, regularPriceUgx: null, inStock: true, fitState: 'AWAITING_VERIFICATION' as const, fitLabel: 'Awaiting verification', condition: null, capacityMah: null, nominalVoltageMv: null,
};

describe('per-phone battery page rules', () => {
  it('a page exists only at a finder-shaped slug', () => {
    expect(isDeviceSlug('tecno-spark-7-kf6')).toBe(true);
    expect(isDeviceSlug('Tecno Spark')).toBe(false);
    expect(isDeviceSlug('../etc')).toBe(false);
    expect(phoneBatteryPath('tecno-spark-7-kf6')).toBe('/phone-batteries/tecno-spark-7-kf6');
  });

  it('indexable only with a battery to show; a verified fit out of stock still counts', () => {
    expect(phonePageIndexable([])).toBe(false);
    expect(phonePageIndexable([result])).toBe(true);
    expect(phonePageIndexable([{ fitState: 'VERIFIED_OUT_OF_STOCK' }])).toBe(true);
  });

  it('title and heading name the phone and the place; nothing else is claimed', () => {
    expect(phonePageTitle(device)).toBe('Tecno Spark 7 (KF6) battery replacement in Kampala | GoldPlus');
    expect(phonePageH1(device)).toBe('Replacement battery for the Tecno Spark 7 (KF6)');
  });

  it('the description says where the fit comes from and never invents a capacity or a verification', () => {
    const d = phonePageDescription(device, [result]);
    expect(d).toContain('BL-49FT');
    expect(d).toContain('UGX 55,000');
    expect(d).toContain("listed by our supplier");
    expect(d).not.toMatch(/mAh|verified|original|genuine|same-day delivery|arrives/i);
    expect(d).toContain('same-day dispatch');
    const checked = phonePageDescription(device, [{ ...result, fitState: 'VERIFIED_IN_STOCK' }]);
    expect(checked).toContain('checked for this phone');
    expect(phonePageDescription(device, [])).toContain('not matched a battery');
  });

  it('structured data states the spare-part relation and only facts the catalogue holds', () => {
    const ld = phonePageItemListJsonLd(device, [result]) as { itemListElement: Array<{ item: Record<string, unknown> }> };
    const item = ld.itemListElement[0].item;
    expect(item.mpn).toBe('BL-49FT');
    expect(item.isAccessoryOrSparePartFor).toEqual({ '@type': 'Product', name: 'Tecno Spark 7 (KF6)', model: 'KF6' });
    expect(item.image).toBe('https://shopgoldplus.com/img/bl-49ft.jpg');
    expect(item).not.toHaveProperty('additionalProperty');   // capacity unknown: not stated
    expect(item).not.toHaveProperty('aggregateRating');
    expect((item.offers as Record<string, unknown>).availability).toBe('https://schema.org/InStock');
    const withCapacity = phonePageItemListJsonLd(device, [{ ...result, capacityMah: 2500 }]) as typeof ld;
    expect(withCapacity.itemListElement[0].item.additionalProperty).toEqual([{ '@type': 'PropertyValue', name: 'Capacity', value: 2500, unitText: 'mAh' }]);
  });

  it('every guide a page links to is a guide published on the live blog (slugs read from /sitemaps/blog.xml, 2026-10-28)', () => {
    const live = new Set([
      'a-swollen-phone-battery-what-to-do-safety-first',
      'original-vs-replacement-phone-batteries-what-actually-differs',
      'signs-your-phone-battery-needs-replacing',
      'tecno-battery-codes-bl-explained',
      'how-to-read-the-code-and-ratings-on-a-phone-battery-label',
      'replacing-an-iphone-battery-what-to-know-before-you-do-it',
      'finding-the-right-battery-for-infinix-and-itel-phones',
      'how-to-find-the-right-replacement-battery-for-your-phone',
    ]);
    for (const brand of ['tecno', 'infinix', 'itel', 'apple', 'samsung', 'nokia']) {
      for (const g of phoneGuides(brand)) expect(live.has(g.href.replace('/blog/', '')), `${brand}: ${g.href}`).toBe(true);
    }
    expect(phoneGuides('tecno')[0].href).toContain('tecno-battery-codes');
    expect(phoneGuides('itel')[0].href).toContain('infinix-and-itel');
    expect(phoneGuides('samsung')).toHaveLength(3);
  });
});

describe('the fit index behind the hub, the sitemap and the finder', () => {
  function finder(rows: Array<typeof device & { brandSlug: string }>, showAwaiting: boolean) {
    const repo = {
      getConfig: async () => ({ config: { showAwaitingVerification: showAwaiting } }),
      devicesWithPublicFits: async (awaiting: boolean) => {
        expect(awaiting).toBe(showAwaiting);
        return rows;
      },
    };
    return new BatteryFinderUseCases(repo as never, {} as never, {} as never);
  }

  it('groups phones by brand, biggest brand first, and counts every phone once', async () => {
    const rows = [
      { ...device, brandSlug: 'tecno' },
      { ...device, id: 'd2', slug: 'tecno-pop-5', model: 'Pop 5', modelNumber: 'BD2p', label: 'Tecno Pop 5 (BD2p)', brandSlug: 'tecno' },
      { ...device, id: 'd3', slug: 'itel-a56', brandName: 'itel', model: 'A56', modelNumber: null, label: 'itel A56', brandSlug: 'itel' },
    ];
    const index = await finder(rows, true).fitIndex();
    expect(index.deviceCount).toBe(3);
    expect(index.brands.map((b) => [b.slug, b.devices.length])).toEqual([['tecno', 2], ['itel', 1]]);
    expect(index.brands[0].devices[1]).toEqual({ slug: 'tecno-pop-5', model: 'Pop 5', modelNumber: 'BD2p', variant: null, label: 'Tecno Pop 5 (BD2p)', verifiedFits: 0, listedFits: 1 });
  });

  it('passes the finder\'s own awaiting switch through, so hidden fits never make a page', async () => {
    const index = await finder([], false).fitIndex();
    expect(index).toEqual({ brands: [], deviceCount: 0 });
  });
});

describe('surfaces agree', () => {
  it('finder, product page and hub all link phones to the per-phone page, not the finder query view', () => {
    for (const f of ['apps/web/src/pages/battery-finder.astro', 'apps/web/src/pages/products/[slug].astro', 'apps/web/src/pages/[hub]/[...child].astro']) {
      const src = read(f);
      expect(src, f).toContain('phoneBatteryPath(');
      expect(src, f).not.toMatch(/href=\{`\/battery-finder\?device=/);
    }
  });
  it('the sitemap lists phone pages from the same fit index the hub renders, and the finder only when indexable', () => {
    const src = read('apps/web/src/pages/sitemaps/hubs.xml.ts');
    expect(src).toContain("'/finder/fit-index'");
    expect(src).toContain('finderConfig.data.indexable');
  });
  it('Clarity sees the hubs, the finder and the phone pages by their real route names', () => {
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    const m = layout.match(/const clarityMaskAll = !(\/.*\/)\.test/);
    expect(m).not.toBeNull();
    const re = new RegExp(m![1].slice(1, -1));
    for (const p of ['/battery-finder', '/phone-batteries/tecno-spark-7', '/power', '/phone-batteries', '/products/x', '/']) expect(re.test(p), p).toBe(true);
    for (const p of ['/checkout', '/account', '/admin/seo', '/batteries']) expect(re.test(p), p).toBe(false);
  });
  it('the battery product route answers for a record in review whose fits are live, as the finder does, and hides one with nothing public', () => {
    const route = read('apps/api/src/interfaces/http/routes/batteries.ts');
    expect(route).toContain('(!found.isPublished && found.devices.length === 0)');
    expect(route).not.toMatch(/if \(!found \|\| !found\.isPublished\) throw/);
  });
  it('no public surface promises that the fit is confirmed before payment', () => {
    for (const f of ['apps/web/src/pages/faq.astro', 'apps/web/src/pages/llms.txt.ts', 'apps/web/src/lib/agentTools.ts', 'apps/web/src/lib/agentDocuments.ts', 'apps/web/src/pages/developers.astro', 'apps/web/src/lib/agentSkill.ts', 'apps/web/src/pages/phone-batteries/[device].astro']) {
      expect(read(f), f).not.toMatch(/confirm(s|ed)? (the fit )?before (you pay|payment|a customer pays)|never pay before|only checked fits/i);
    }
  });
});
