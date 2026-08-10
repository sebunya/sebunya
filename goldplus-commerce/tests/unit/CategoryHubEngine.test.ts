import { describe, expect, it } from 'vitest';
import { DEFAULT_TAXONOMY, type ProductPublicDto } from '@goldplus/shared';
import {
  BANNED_PHRASES,
  CATEGORY_HUBS,
  DEFAULT_RELEASE_GATE,
  evaluateLocalPageGate,
  evaluateReleaseGate,
  gatePassingHubPaths,
  getHub,
  hasVerifiedWarrantyFact,
  hubPath,
  isHubSlug,
  localPagePaths,
  productsForHub,
  productsForHubChild,
} from '../../apps/web/src/lib/categoryHubs';

/**
 * CATEGORY AUTHORITY ENGINE — registry integrity, release-gate purity, local
 * page gating and gate-aware sitemap inclusion.
 */

function product(overrides: Partial<ProductPublicDto> = {}): ProductPublicDto {
  return {
    id: overrides.id ?? `p-${Math.random().toString(36).slice(2)}`,
    slug: 'test-product',
    name: 'GoldPlus Power Bank 10000',
    categoryName: 'Power Devices',
    shortDescription: null,
    longDescription: null,
    sku: null,
    modelNumber: null,
    retailPriceUgx: 50_000,
    availability: { kind: 'in_stock', quantity: 5 },
    hasImage: true,
    primaryImageUrl: 'https://example.com/img.jpg',
    verifiedSpecs: {},
    hasMissingSpecs: false,
    images: [],
    attributeValues: [],
    ...overrides,
  } as ProductPublicDto;
}

describe('hub registry integrity', () => {
  it('has unique hub slugs and unique child slugs per hub', () => {
    const slugs = CATEGORY_HUBS.map((h) => h.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const hub of CATEGORY_HUBS) {
      const childSlugs = hub.children.map((c) => c.slug);
      expect(new Set(childSlugs).size).toBe(childSlugs.length);
    }
  });

  it('hub slugs never collide with existing top-level static pages', () => {
    const reserved = ['shop', 'cart', 'checkout', 'products', 'support', 'admin', 'account', 'loyalty', 'locations', 'delivery', 'sitemaps'];
    for (const hub of CATEGORY_HUBS) expect(reserved).not.toContain(hub.slug);
  });

  it('every taxonomy-mapped slug is a non-empty string that exists in DEFAULT_TAXONOMY', () => {
    for (const hub of CATEGORY_HUBS) {
      if (hub.categorySlug !== null) {
        expect(hub.categorySlug.length).toBeGreaterThan(0);
        expect(DEFAULT_TAXONOMY.some((c) => c.slug === hub.categorySlug)).toBe(true);
      }
      if (hub.taxonomyMapped) expect(hub.categorySlug).not.toBeNull();
      for (const child of hub.children) {
        if (child.subcategorySlug !== null) {
          expect(child.subcategorySlug.length).toBeGreaterThan(0);
          const parent = DEFAULT_TAXONOMY.find((c) => c.slug === hub.categorySlug);
          expect(parent?.subcategories.some((s) => s.slug === child.subcategorySlug)).toBe(true);
        }
        if (child.taxonomyMapped) expect(child.subcategorySlug).not.toBeNull();
        // Unmapped children must still have a way to gather products.
        if (!child.taxonomyMapped) expect((child.keywordFilter ?? []).length).toBeGreaterThan(0);
      }
    }
  });

  it('meta descriptions are 50-160 characters on hubs and children', () => {
    for (const hub of CATEGORY_HUBS) {
      expect(hub.metaDescription.length, hub.slug).toBeGreaterThanOrEqual(50);
      expect(hub.metaDescription.length, hub.slug).toBeLessThanOrEqual(160);
      for (const child of hub.children) {
        expect(child.metaDescription.length, `${hub.slug}/${child.slug}`).toBeGreaterThanOrEqual(50);
        expect(child.metaDescription.length, `${hub.slug}/${child.slug}`).toBeLessThanOrEqual(160);
      }
    }
  });

  it('no banned superlative phrases anywhere in hub copy', () => {
    const text = JSON.stringify(CATEGORY_HUBS).toLowerCase();
    for (const phrase of BANNED_PHRASES) {
      expect(text.includes(phrase.toLowerCase()), `banned phrase: ${phrase}`).toBe(false);
    }
  });

  it('faq entries either carry a static answer or a live-data source, never neither', () => {
    for (const hub of CATEGORY_HUBS) {
      for (const faq of hub.faqs) expect(Boolean(faq.answer) || Boolean(faq.source)).toBe(true);
    }
  });

  it('isHubSlug / getHub agree with the registry', () => {
    expect(isHubSlug('power')).toBe(true);
    expect(isHubSlug('shop')).toBe(false);
    expect(getHub('storage')?.categorySlug).toBe('storage-devices');
  });
});

describe('release gate (pure)', () => {
  it('fails under minProducts', () => {
    const r = evaluateReleaseGate([product()], DEFAULT_RELEASE_GATE);
    expect(r.pass).toBe(false);
    expect(r.eligibleCount).toBe(1);
  });

  it('fails when products lack images and requireImages is true', () => {
    const r = evaluateReleaseGate(
      [product({ primaryImageUrl: null }), product({ primaryImageUrl: null })],
      DEFAULT_RELEASE_GATE,
    );
    expect(r.pass).toBe(false);
    expect(r.eligibleCount).toBe(0);
  });

  it('ignores out-of-stock and pre-order products', () => {
    const r = evaluateReleaseGate(
      [product({ availability: { kind: 'out_of_stock' } }), product({ availability: { kind: 'pre_order' } }), product()],
      DEFAULT_RELEASE_GATE,
    );
    expect(r.pass).toBe(false);
    expect(r.eligibleCount).toBe(1);
  });

  it('passes with enough in-stock photographed products', () => {
    const r = evaluateReleaseGate([product(), product()], DEFAULT_RELEASE_GATE);
    expect(r.pass).toBe(true);
    expect(r.eligibleCount).toBe(2);
  });

  it('allows image-less products through when requireImages is false', () => {
    const r = evaluateReleaseGate(
      [product({ primaryImageUrl: null }), product({ primaryImageUrl: null })],
      { minProducts: 2, requireImages: false },
    );
    expect(r.pass).toBe(true);
  });
});

describe('hub product mapping (pure)', () => {
  it('maps products by taxonomy category name', () => {
    const power = getHub('power')!;
    const inHub = product();
    const other = product({ categoryName: 'Sound Devices' });
    expect(productsForHub(power, [inHub, other], DEFAULT_TAXONOMY)).toEqual([inHub]);
  });

  it('narrows children by subcategory inference and keyword filters', () => {
    const power = getHub('power')!;
    const bank = product({ name: 'GoldPlus Power Bank 20000' });
    const charger = product({ name: 'GoldPlus Fast Charger' });
    const cable = product({ name: 'GoldPlus USB-C Cable 1m' });
    const all = [bank, charger, cable];
    const banks = productsForHubChild(power, power.children.find((c) => c.slug === 'power-banks')!, all, DEFAULT_TAXONOMY);
    expect(banks).toEqual([bank]);
    const cables = productsForHubChild(power, power.children.find((c) => c.slug === 'charging-cables')!, all, DEFAULT_TAXONOMY);
    expect(cables).toEqual([cable]);
  });

  it('keyword-filtered hubs (phone-batteries) only match battery products in the mapped category', () => {
    const hub = getHub('phone-batteries')!;
    const battery = product({ name: 'GoldPlus Phone Battery BL-5C' });
    const bank = product({ name: 'GoldPlus Power Bank 10000' });
    expect(productsForHub(hub, [battery, bank], DEFAULT_TAXONOMY)).toEqual([battery]);
  });
});

describe('local page gating (pure)', () => {
  it('passes only with both address and phone', () => {
    expect(evaluateLocalPageGate({ addressLine1: 'Wilson Road, Kampala', phoneDisplay: '0705 004545' })).toBe(true);
    expect(evaluateLocalPageGate({ addressLine1: '', phoneDisplay: '0705 004545' })).toBe(false);
    expect(evaluateLocalPageGate({ addressLine1: 'Wilson Road', phoneDisplay: '  ' })).toBe(false);
    expect(evaluateLocalPageGate({})).toBe(false);
  });

  it('localPagePaths lists both pages when gated in, none when gated out', () => {
    expect(localPagePaths({ addressLine1: 'Wilson Road', phoneDisplay: '0705' })).toEqual([
      '/locations/wilson-road',
      '/delivery/kampala-wakiso',
    ]);
    expect(localPagePaths({ addressLine1: null, phoneDisplay: '0705' })).toEqual([]);
  });
});

describe('sitemap inclusion (pure, gate-aware)', () => {
  it('excludes gated-out hubs and includes passing hubs + passing children', () => {
    const catalogue = [
      product({ name: 'GoldPlus Power Bank 10000' }),
      product({ name: 'GoldPlus Power Bank 20000' }),
    ];
    const paths = gatePassingHubPaths(catalogue, DEFAULT_TAXONOMY);
    expect(paths).toContain('/power');
    expect(paths).toContain('/power/power-banks');
    // chargers child has no eligible products → excluded even though parent passes
    expect(paths).not.toContain('/power/chargers');
    // no audio/storage stock at all → hubs excluded entirely
    expect(paths).not.toContain('/audio');
    expect(paths).not.toContain('/storage');
  });

  it('excludes children of a gated-out parent even if the child would pass', () => {
    const catalogue = [
      product({ name: 'GoldPlus USB Flash Drive 32GB', categoryName: 'Storage Devices' }),
      product({ name: 'GoldPlus USB Flash Drive 64GB', categoryName: 'Storage Devices' }),
    ];
    // Storage parent passes here (2 products); prove the child path shape too.
    const paths = gatePassingHubPaths(catalogue, DEFAULT_TAXONOMY);
    expect(paths).toContain('/storage');
    expect(paths).toContain('/storage/usb-flash-drives');
    expect(paths).not.toContain('/storage/memory-cards');

    // Now gate the parent out (no images) — nothing storage-related is listed.
    const bare = catalogue.map((p) => ({ ...p, primaryImageUrl: null }));
    const gated = gatePassingHubPaths(bare, DEFAULT_TAXONOMY);
    expect(gated.filter((p) => p.startsWith('/storage'))).toEqual([]);
  });

  it('empty catalogue yields no hub paths (fail closed)', () => {
    expect(gatePassingHubPaths([], DEFAULT_TAXONOMY)).toEqual([]);
  });

  it('hubPath builds parent and child paths', () => {
    expect(hubPath('power')).toBe('/power');
    expect(hubPath('power', 'chargers')).toBe('/power/chargers');
  });
});

describe('warranty fact detection', () => {
  it('detects verified warranty facts only', () => {
    expect(hasVerifiedWarrantyFact([product()])).toBe(false);
    expect(hasVerifiedWarrantyFact([product({ verifiedSpecs: { 'Warranty Period': '6 months' } })])).toBe(true);
    expect(
      hasVerifiedWarrantyFact([
        product({ attributeValues: [{ name: 'Warranty', unit: null, value: '6 months', isVerified: false }] }),
      ]),
    ).toBe(false);
    expect(
      hasVerifiedWarrantyFact([
        product({ attributeValues: [{ name: 'Warranty', unit: null, value: '6 months', isVerified: true }] }),
      ]),
    ).toBe(true);
  });
});
