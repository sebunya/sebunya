import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

/**
 * What an answer engine needs to CITE the shop, rather than merely index it:
 * a business it can pin to a street and opening hours, list pages that say
 * what they list, and a plain-text brief it can read in one fetch. Every value
 * comes from the admin-editable business info or the live catalogue — a fixed
 * address or a hand-typed product count would drift the moment the shop moves
 * or the catalogue changes.
 */
describe('answer-engine surfaces', () => {
  it('the homepage describes the shop as a place, from business info only', () => {
    const src = read('apps/web/src/components/SiteJsonLd.astro');
    expect(src).toContain("'@type': 'Store'");
    expect(src).toContain('streetAddress: biz.addressLine1');
    expect(src).toContain('telephone: biz.phoneDial');
    expect(src).toMatch(/if \(openingHours\) store\.openingHours = openingHours;/);
    // Nothing invented: no literal address, phone or hours in the component.
    expect(src).not.toMatch(/Wilson Road|\+256|8:30am/);
    expect(src).toContain('serializeJsonLd(store)');
  });

  it('parsed opening hours are omitted rather than guessed when the format is unfamiliar', () => {
    const src = read('apps/web/src/components/SiteJsonLd.astro');
    expect(src).toMatch(/const openingHours = .*\? *`\$\{dayRange\[0\]\}-\$\{dayRange\[1\]\} \$\{hoursRange\[0\]\}-\$\{hoursRange\[1\]\}`\s*: null;/s);
  });

  it('one GoldPlus entity: the Store and the WebSite reference the Organization by id', () => {
    const src = read('apps/web/src/components/SiteJsonLd.astro');
    expect(src).toContain('const ORG_ID = `${SITE_ORIGIN}/#organization`;');
    expect(src).toContain("'@id': ORG_ID,");
    expect(src).toContain('parentOrganization: { \'@id\': ORG_ID }');
    expect(src).toContain('publisher: { \'@id\': ORG_ID }');
  });

  it('category hub pages carry the same product facts as the shop page', () => {
    const src = read('apps/web/src/pages/[hub]/[...child].astro');
    expect(src).toContain("'@type': 'Product'");
    expect(src).toContain("priceCurrency: 'UGX'");
    expect(src).toContain('numberOfItems: Math.min(products.length, 24)');
  });

  it('the shop page states what it lists', () => {
    const src = read('apps/web/src/pages/shop.astro');
    expect(src).toContain("import { serializeJsonLd, breadcrumbJsonLd } from '../lib/jsonld';");
    expect(src).toContain("'@type': 'ItemList'");
    expect(src).toContain('numberOfItems: pageProducts.length');
    expect(src).toContain('serializeJsonLd(shopItemList)');
    expect(src).toContain('serializeJsonLd(shopBreadcrumb)');
  });

  it('llms.txt is generated from live data, never fixed copy', () => {
    const src = read('apps/web/src/pages/llms.txt.ts');
    expect(src).toContain('fetchApprovedCatalogue');
    expect(src).toContain('getBusinessInfo');
    expect(src).toContain('text/plain; charset=utf-8');
    expect(src).toMatch(/# GoldPlus/);
    // The catalogue decides the categories and the count.
    expect(src).toContain('byCategory');
    expect(src).toContain('${products.length} products are listed online');
    expect(src).not.toMatch(/Wilson Road|0705 004545/);
  });
});

/**
 * The FAQ is the page an answer engine quotes for "does GoldPlus deliver",
 * "where is the shop", "which battery fits my phone". Its promises must be
 * the site's existing promises: business info, the checkout's own payment
 * copy, and the returns page's own wording — never a new commitment.
 */
describe('the FAQ answers from the site\'s own commitments', () => {
  const src = read('apps/web/src/pages/faq.astro');

  it('renders the visible answers and the FAQPage data from one array', () => {
    expect(src).toContain("'@type': 'FAQPage'");
    expect(src).toContain('mainEntity: faqs.map');
    expect(src).toContain('{faqs.map((f) => (');
    expect((src.match(/^\s*q: '/gm) ?? []).length).toBe(5);
  });

  it('states the owner-set returns policy from the one constant', () => {
    expect(src).toContain("import { RETURNS_POLICY } from '../lib/returnsPolicy';");
    expect(src).toContain('${RETURNS_POLICY.windowDays} days of delivery');
    expect(src).toContain('GoldPlus pays the cost of getting it back to us');
    const policy = read('apps/web/src/lib/returnsPolicy.ts');
    expect(policy).toContain('windowDays: 14');
    expect(policy).toContain("changeOfMindShippingPaidBy: 'customer'");
    expect(policy).toContain("faultyShippingPaidBy: 'GoldPlus'");
    // The policy page and the offer schema read the same decision.
    expect(read('apps/web/src/pages/returns.astro')).toContain('14 days from delivery or collection');
    const pdp = read('apps/web/src/components/ProductJsonLd.astro');
    expect(pdp).toContain('hasMerchantReturnPolicy: merchantReturnPolicyJsonLd()');
    expect(policy).toContain('MerchantReturnFiniteReturnWindow');
    expect(policy).toContain('merchantReturnDays: RETURNS_POLICY.windowDays');
  });

  it('sources every answer, inventing no policy', () => {
    expect(src).toContain('getBusinessInfo');
    expect(src).toContain('getStorefrontCopy');
    expect(src).toContain('biz.deliveryNote');
    expect(src).toContain('copy.payment.pesapal.description');
    // No hard-coded address, phone, hours, or a returns window the policy page does not state.
    expect(src).not.toMatch(/Wilson Road|0705 004545|8:30am/);
    // No literal window in the copy: the number comes from the shared constant.
    expect(src).not.toMatch(/\b(7|14|30)[- ]days? of\b/);
  });

  it('is reachable: sitemap, footer and llms.txt point at it', () => {
    expect(read('apps/web/src/lib/sitemap.ts')).toContain("'/faq'");
    expect(read('apps/web/src/layouts/BaseLayout.astro')).toContain('href="/faq"');
    expect(read('apps/web/src/pages/llms.txt.ts')).toContain('/faq');
  });
});

/**
 * Every URL these pages hand to a customer or an answer engine must exist.
 * /delivery was published in llms.txt and the FAQ while the real page is
 * /delivery/kampala-wakiso — a 404 quoted to an assistant is worse than no
 * link at all.
 */
describe('published links point at real pages', () => {
  const pageFiles = ['apps/web/src/pages/llms.txt.ts', 'apps/web/src/pages/faq.astro'];
  it('never links to /delivery, which does not exist', () => {
    for (const f of pageFiles) {
      expect(read(f), f).not.toMatch(/["'`]\/delivery["'`]|SITE_ORIGIN\}\/delivery`/);
    }
  });
  it('links to the delivery page that does exist', () => {
    expect(read('apps/web/src/pages/llms.txt.ts')).toContain('/delivery/kampala-wakiso');
    expect(read('apps/web/src/pages/faq.astro')).toContain('/delivery/kampala-wakiso');
    // The route file backing it.
    expect(() => read('apps/web/src/pages/delivery/kampala-wakiso.astro')).not.toThrow();
  });
});

/**
 * Crawlers request /favicon.ico and /apple-touch-icon.png by convention no
 * matter what the link tags say — both 404'd for Googlebot and Applebot until
 * 2026-09-02, and an SVG apple-touch-icon is ignored by Apple devices entirely.
 */
describe('the icons crawlers ask for by convention exist', () => {
  it('ships a real .ico and a PNG touch icon', () => {
    const ico = readFileSync(resolve(ROOT, 'apps/web/public/favicon.ico'));
    // ICO container: reserved 0, type 1 (icon), one image.
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(1);
    const png = readFileSync(resolve(ROOT, 'apps/web/public/apple-touch-icon.png'));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('declares them, and never points Apple at an SVG', () => {
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    expect(layout).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32" />');
    expect(layout).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />');
    expect(layout).not.toMatch(/apple-touch-icon"[^>]*\.svg/);
  });
});

describe('the blog has a feed', () => {
  it('serves valid RSS even with nothing published, and is discoverable', () => {
    const feed = read('apps/web/src/pages/rss.xml.ts');
    expect(feed).toContain("'Content-Type': 'application/rss+xml; charset=utf-8'");
    expect(feed).toContain('rel="self"');
    // An error must not reach a feed reader, which backs off for a long time.
    expect(feed).toContain('} catch {');
    expect(read('apps/web/src/layouts/BaseLayout.astro')).toContain('type="application/rss+xml"');
    expect(read('apps/web/src/pages/llms.txt.ts')).toContain('/rss.xml');
  });
});

/**
 * The brand mark the owner supplied (2026-09-02). A wordmark is unreadable at
 * 32px, so small icons carry the monogram; and social platforms cannot render
 * an SVG, so the default share card and the publisher logo are raster.
 */
describe('brand assets are raster where raster is required', () => {
  it('the favicon holds several real sizes', () => {
    const ico = readFileSync(resolve(ROOT, 'apps/web/public/favicon.ico'));
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(3);
  });

  it('shares a PNG card, never an SVG', () => {
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    expect(layout).toContain("image = '/og-default.png',");
    expect(layout).not.toMatch(/image = '\/[^']*\.svg'/);
    const card = readFileSync(resolve(ROOT, 'apps/web/public/og-default.png'));
    expect(card.subarray(1, 4).toString('ascii')).toBe('PNG');
    // 1200x630 is what the platforms crop to.
    expect(card.readUInt32BE(16)).toBe(1200);
    expect(card.readUInt32BE(20)).toBe(630);
    expect(read('apps/web/src/pages/blog/[slug].astro')).toContain('/icon-512.png');
  });

  it('installs get PNG icons including a maskable one', () => {
    const manifest = JSON.parse(read('apps/web/public/manifest.json')) as { icons: Array<{ src: string; type: string; purpose: string }> };
    expect(manifest.icons.some((i) => i.type === 'image/png' && i.purpose === 'any')).toBe(true);
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });
});
