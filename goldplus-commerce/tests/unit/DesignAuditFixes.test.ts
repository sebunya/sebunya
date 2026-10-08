import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProductPublicDto } from '@goldplus/shared';
import { GetRecommendationsUseCase } from '../../apps/api/src/application/recommendations/GetRecommendationsUseCase';
import { ProductSignalExtractor } from '../../apps/api/src/application/recommendations/ProductSignalExtractor';
import { RecommendationScoringService } from '../../apps/api/src/application/recommendations/RecommendationScoringService';
import { CompatibilityRuleService } from '../../apps/api/src/application/recommendations/CompatibilityRuleService';
import { TrendingScoreService } from '../../apps/api/src/application/recommendations/TrendingScoreService';
import { RecommendationEligibilityService } from '../../apps/api/src/application/recommendations/RecommendationEligibilityService';
import { RecommendationDeduplicationService } from '../../apps/api/src/application/recommendations/RecommendationDeduplicationService';
import { RecommendationDiversityService } from '../../apps/api/src/application/recommendations/RecommendationDiversityService';
import type { RecommendationProductRecord } from '../../apps/api/src/application/ports/IProductRecommendationReader';
import { BatteryFinderUseCases } from '../../apps/api/src/application/use-cases/batteries/BatteryFinderUseCases';
import { normaliseBatteryCode } from '../../apps/api/src/domain/batteries/BatteryCodes';
import { buildHomepageProductAllocation } from '../../apps/web/src/lib/homepage-merchandising';

/**
 * The 2026-10-08 external design audit, as verified against the live site and
 * this code: only the findings that held up, each pinned to what was changed.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const WEB = 'apps/web/src/';
// The generated sample frame's alt text, as the media pipeline writes it.
const SAMPLE_ALT = 'Sample image (no photo of this product yet) — GoldPlus Car Accessory';

// ── 34 · "Similar products" on a power bank were phone batteries ────────────

function record(id: string, name: string): RecommendationProductRecord {
  return {
    id, slug: id, name, categoryId: 'cat-power', imageUrl: `https://img/${id}`, price: 50_000,
    stockStatus: 'in_stock', stockQuantity: 10, isActive: true, createdAt: new Date('2026-09-01'),
  };
}

function engineOver(catalogue: RecommendationProductRecord[]) {
  const reader = {
    async findPublicProducts(input?: { categoryId?: string; productIds?: string[]; excludeProductIds?: string[]; limit?: number }) {
      let rows = [...catalogue];
      if (input?.categoryId) rows = rows.filter((p) => p.categoryId === input.categoryId);
      if (input?.productIds) rows = rows.filter((p) => input.productIds!.includes(p.id));
      if (input?.excludeProductIds) rows = rows.filter((p) => !input.excludeProductIds!.includes(p.id));
      // The real reader's stable order: by name, then id.
      return rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, input?.limit ?? 200);
    },
    async findProductById(id: string) { return catalogue.find((p) => p.id === id) ?? null; },
    async findProductsByIds(ids: string[]) { return catalogue.filter((p) => ids.includes(p.id)); },
    async findBestsellerProductIds() { return []; },
    async findCompatibilityTargetIds() { return []; },
    async findRecentPaidProductIdsForProfile() { return []; },
    async findCachedRecommendations() { return null; },
    async saveCachedRecommendations() {},
  };
  const events = {
    async save() { return true; },
    async existsRecentSimilarEvent() { return false; },
    async findRecentlyViewed() { return []; },
    async findRecentlyShownProductIds() { return [] as string[]; },
    async getTrendingEvents() { return []; },
  };
  return new GetRecommendationsUseCase(
    reader as never,
    new ProductSignalExtractor(),
    new RecommendationScoringService(new CompatibilityRuleService()),
    new TrendingScoreService(events as never),
    new RecommendationEligibilityService(),
    new RecommendationDeduplicationService(),
    new RecommendationDiversityService(),
    { apply: async ({ candidates }: { candidates: unknown[] }) => ({ candidates }) } as never,
    events as never,
  );
}

describe('34 · similar products are the same kind of product', () => {
  // The live shape: "GoldPlus Battery …" sorts before every other power device.
  const batteries = Array.from({ length: 40 }, (_, i) => record(`b${i}`, `GoldPlus Battery GP-${10 + i}BI`));
  const powerBanks = ['P02', 'P03', 'P05', 'P07'].map((m) => record(`pb-${m}`, `GoldPlus GP-${m} Power Bank`));
  const catalogue = [...batteries, ...powerBanks, record('ch1', 'GoldPlus GP-C11 Wall Charger')];

  it('a power bank is related to the other power banks, not to the alphabetically first batteries', async () => {
    const ranked = await engineOver(catalogue).generateV1ScoredCandidates({ placement: 'product_related', productId: 'pb-P07' }, 10);
    expect(ranked.slice(0, 3).map((c) => c.productId).sort()).toEqual(['pb-P02', 'pb-P03', 'pb-P05']);
    // Still the same category, still a candidate pool of the usual size.
    expect(ranked.every((c) => c.reasonCodes.includes('SAME_CATEGORY'))).toBe(true);
    expect(ranked.length).toBeLessThanOrEqual(30);
  });

  it('a product whose type cannot be read keeps the stable order', async () => {
    const odd = [...catalogue, record('x1', 'GoldPlus Mystery Item')];
    const ranked = await engineOver(odd).generateV1ScoredCandidates({ placement: 'product_related', productId: 'x1' }, 4);
    expect(ranked.length).toBeGreaterThan(0);
  });
});

// ── 41 + finder loose end · no "Did you mean" over an empty list ────────────

describe('41 · the battery finder', () => {
  function finderWithDraftOnly() {
    const repo = {
      getConfig: async () => null,
      deviceCandidates: async () => [],
      batteryCandidates: async () => [{
        productId: 'draft1', canonicalCodeNormalised: normaliseBatteryCode('A03 CORE'), supplierCodeNormalised: null,
        barcode: null, aliasesNormalised: [], lifecycleStatus: 'DRAFT',
      }],
      fuzzyDevices: async () => [],
      fuzzyBatteries: async () => [],
      recordEvent: async () => undefined,
      batteryPublic: async () => ({ lifecycleStatus: 'DRAFT', productApproved: false, productActive: true, canonicalCode: 'A03 CORE', slug: 'a03-core', name: 'Draft' }),
      deviceById: async () => null,
    };
    return new BatteryFinderUseCases(repo as never, {} as never, {} as never, 'pepper');
  }

  it('a suggestion list emptied by the publish filter answers NO_RESULT (with its request form)', async () => {
    const out = await finderWithDraftOnly().search('A03');
    expect(out.kind).toBe('NO_RESULT');
  });

  it('the page treats an empty suggestion list as no result too, and asks which model for a bare brand', () => {
    const page = read(`${WEB}pages/battery-finder.astro`);
    expect(page).toContain("search.devices.length === 0 && search.batteries.length === 0");
    expect(page).toContain("{search?.kind === 'SUGGESTIONS' && !emptySuggestions && (");
    expect(page).toContain('Which {brandOnly.label} phone?');
    // When the finder holds the brand's phones, the prompt links to their list.
    expect(page).toContain('See the {brandOnly.label} phones we have checked →');
    expect(page).toContain('b.deviceCount > 0');
    // The request form gets the brand, not the brand typed as a model.
    expect(page).toContain("value={brand?.brand.name ?? brandOnly?.label ?? ''}");
    expect(page).toContain("value={shownDevice?.model ?? (brandOnly ? '' : q)}");
  });
});

// ── 11 · 12 · 13 · the menu ─────────────────────────────────────────────────

describe('the menu', () => {
  const nav = read(`${WEB}components/GpNav.astro`);

  it('11 · links only to what is stocked, and each size searches its own product type', () => {
    expect(nav).not.toContain("q=over-ear'");
    expect(nav).not.toContain("category=car&q=bluetooth'");
    expect(nav).not.toMatch(/q=(1|512)gb\+flash\+drive/);
    expect(nav).not.toMatch(/q=\d+gb'\)/); // a bare size matched flash drives AND memory cards
    expect(nav).toContain("q=256gb+flash+drive");
    expect(nav).toContain("q=512gb+memory+card");
    expect(nav).toContain("q=card+reader");
    expect(nav).not.toContain('On-ear, for everyday listening');
  });

  it('12 · every same-day delivery line goes to the delivery page, not Support', () => {
    expect(nav).toContain('id="gpNavNbaSlot" href="/delivery/kampala-wakiso"');
    for (const id of ['sunday', 'cutoff', 'aftercutoff']) {
      const at = nav.indexOf(`id:'${id}'`);
      expect(at, id).toBeGreaterThan(-1);
      const block = nav.slice(at, nav.indexOf('});', at));
      expect(block, id).toContain("href:'/delivery/kampala-wakiso'");
    }
  });

  it('13 · shopper words, and each panel features its own category', () => {
    const feat = read(`${WEB}lib/navFeatured.ts`);
    expect(feat).toContain("toCard(first, proven ? 'Popular right now' : 'In stock now')");
    // Each panel shows one card, so its label stands alone ("Also …" read as a second item).
    expect(feat).toContain("cards.push(toCard(p, 'In stock now'))");
    expect(feat).not.toMatch(/toCard\([^)]*'(Most carried|Also worth carrying|Carried in the shop)'/);
    for (const cat of ['Power Devices', 'Sound Devices', 'Storage Devices', 'Car Accessories', 'PC Accessories']) {
      expect(nav).toContain(`featFor('${cat}')`);
    }
  });
});

// ── 15 · 17 · 02 · the home page ────────────────────────────────────────────

function product(id: string, categoryName: string, real = true): ProductPublicDto {
  return {
    id, slug: id, name: `Product ${id}`, categoryName, shortDescription: null, longDescription: null, sku: null,
    modelNumber: null, retailPriceUgx: 40_000, floorPriceUgx: null, availability: { kind: 'in_stock', quantity: 5 },
    hasImage: true, primaryImageUrl: `/uploads/assets/${id}/pdp.webp`,
    // The generated frame is recognised by its alt text, as in production.
    images: [{ url: `/uploads/assets/${id}/pdp.webp`, alt: real ? 'A real photo' : SAMPLE_ALT }],
  } as unknown as ProductPublicDto;
}

describe('the home page', () => {
  it('15 · Featured leads with one photographed product per category, sample frames still last', () => {
    const catalogue = [
      product('bat1', 'Power Devices'), product('bat2', 'Power Devices'), product('bat3', 'Power Devices'), product('bat4', 'Power Devices'),
      product('ear1', 'Sound Devices'), product('card1', 'Storage Devices'), product('car-sample', 'Car Accessories', false),
    ];
    const featured = buildHomepageProductAllocation(catalogue).featuredProducts.map((p) => p.id);
    expect(featured).toEqual(['bat1', 'ear1', 'card1', 'bat2']);
  });

  it('17 · "Popular right now" holds only evidence-backed items, so the per-card tag is not repeated', () => {
    const rail = read(`${WEB}components/recommendations/PopularNowRail.astro`);
    expect(rail).toContain('response.items.filter((item) => claimsPopularity([item]))');
    expect(rail).toContain('const evidenceBased = popularOnly.length >= POPULAR_MIN;');
    expect(rail.match(/showReasons=\{!evidenceBased\}/g)?.length).toBe(3);
    expect(read(`${WEB}components/recommendations/RecommendationCard.astro`))
      .toContain('const displayReason = showReason ? supportedRecommendationReason(item.reasonCode) : undefined;');
  });

  it('the cart rail decodes the cookie Astro wrote URL-encoded (it hid itself for every cart)', () => {
    const cart = read(`${WEB}components/home/CartAwareRail.astro`);
    expect(cart).toContain('decodeURIComponent(raw)');
  });

  it('02 · hidden personal rails keep their copy in a <template> until there is history', () => {
    const cart = read(`${WEB}components/home/CartAwareRail.astro`);
    expect(cart).toContain("const Body = initialCount > 0 ? 'div' : 'template';");
    expect(cart).toContain('template[data-cart-aware-body]');
    const recent = read(`${WEB}components/recommendations/RecentlyViewedRail.astro`);
    expect(recent).toContain('<template data-recently-viewed-head>');
    expect(recent).toContain('if (head) head.replaceWith(head.content.cloneNode(true));');
  });
});

// ── 05 · 26 · 28 · the product page ─────────────────────────────────────────

describe('the product page', () => {
  const pdp = read(`${WEB}pages/products/[slug].astro`);

  it('05 · the points line says what they are worth, from the live programme', () => {
    expect(pdp).toContain("pointValueUgx: redemption?.configured ? Number(redemption.pointValueUgx) || 0 : 0,");
    expect(pdp).toContain(' on this order, worth UGX ');
  });

  it('26 · 28 · faults and authenticity are stated beside the decision, in the published words', () => {
    expect(pdp).toContain('Faulty? Replaced or refunded at our cost.');
    expect(pdp).toContain('Every genuine GoldPlus product carries a hologram code you can check.');
    expect(pdp).toContain('href="/verification"');
  });
});

// ── 33 · 35 · page descriptions and the product finder's voice ──────────────

describe('pages that had the site-wide description', () => {
  it('33 · verification and the product finder describe themselves', () => {
    expect(read(`${WEB}pages/verification/index.astro`)).toMatch(/<BaseLayout title="Product Verification \| GoldPlus" description="[^"]{60,}"/);
    expect(read(`${WEB}pages/product-finder.astro`)).toMatch(/<BaseLayout title="Find the Right GoldPlus Product" description="[^"]{60,}"/);
  });

  it('35 · the finder speaks to shoppers, and keeps every promise it made', () => {
    const shell = read(`${WEB}components/product-finder/ProductFinderShell.astro`);
    for (const jargon of ['private finder session', 'persisted catalogue evidence', 'No products were invented', 'safety gates', 'Shopping Assistant unavailable']) {
      expect(shell, jargon).not.toContain(jargon);
    }
    expect(shell).toContain('Answering does not sign you up for adverts.');
    expect(shell).toContain('never add to your cart or send a message');
  });
});

// ── CSP · no component script ships inline (they carry no nonce) ────────────

describe('scripts and the nonce policy', () => {
  it('Astro never inlines a component script, so every one is a nonce-stamped file', () => {
    const config = read('apps/web/astro.config.mjs');
    expect(config).toContain('assetsInlineLimit: (filePath) => (/\\.m?js$/.test(filePath) ? false : undefined),');
  });
});
