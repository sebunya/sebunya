import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The catalogue is about to grow from 8 products to a full product list.
 * These guard the things that are invisible at 8 products and break at 80.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

describe('every surface that filters in the page sees the whole catalogue', () => {
  const lib = read('apps/web/src/lib/catalogue.ts');

  it('pages through the catalogue, bounded, stopping on a short page', () => {
    expect(lib).toMatch(/offset=\$\{page \* CATALOGUE_PAGE_SIZE\}/);
    expect(lib).toMatch(/page < CATALOGUE_MAX_PAGES/);
    expect(lib).toMatch(/if \(body\.data\.length < CATALOGUE_PAGE_SIZE\) break;/);
    expect(lib).toMatch(/if \(!response\.ok\) break;/);
  });

  it('there is ONE implementation, used by all three surfaces', () => {
    // The shop and its search, the SEO hub pages (whose release gate counts
    // products), and the hub sitemap. Three copies would drift.
    for (const f of [
      'apps/web/src/pages/shop.astro',
      'apps/web/src/pages/[hub]/[...child].astro',
      'apps/web/src/pages/sitemaps/hubs.xml.ts',
    ]) {
      expect(read(f), f).toMatch(/fetchApprovedCatalogue\(apiBase\)/);
      // The unpaged call is what truncated them; it must not come back.
      expect(read(f), f).not.toMatch(/fetch\(`\$\{apiBase\}\/products`/);
    }
  });

  it('search results never wait on telemetry', () => {
    const shop = read('apps/web/src/pages/shop.astro');
    const block = shop.slice(shop.indexOf('search-events') - 400, shop.indexOf('search-events') + 200);
    expect(block).not.toMatch(/await fetch\(`\$\{apiBase\}\/products\/search-events`/);
    expect(block).toMatch(/resultCount: filteredProducts\.length/);
  });
});

describe('the shop grid is paginated', () => {
  const shop = read('apps/web/src/pages/shop.astro');
  it('renders one page of cards, not the whole catalogue', () => {
    expect(shop).toMatch(/const PAGE_SIZE = 24;/);
    expect(shop).toMatch(/pageProducts\.map\(\(product, index\)/);
    expect(shop).not.toMatch(/\{products\.map\(\(product, index\)/);
  });
  it('filters return to page 1; a page past the end shows the last page; crawlers get prev/next and the page in the canonical', () => {
    expect(shop).toMatch(/page: 1, \.\.\.overrides/);
    expect(shop).toMatch(/const page = Math\.min\(requestedPage, totalPages\);/);
    expect(shop).toMatch(/rel="prev"/); expect(shop).toMatch(/rel="next"/);
    expect(shop).toMatch(/crawlParams\.page = String\(requestedPage\)/);
  });
});

describe('the public product list can be paged at all', () => {
  it('offset reaches the database through every layer', () => {
    expect(read('apps/api/src/application/ports/IProductRepository.ts')).toMatch(/offset\?: number;/);
    expect(read('apps/api/src/interfaces/http/routes/products.ts')).toMatch(/c\.req\.query\('offset'\)/);
    expect(read('apps/api/src/application/use-cases/products/ListPublicProductsUseCase.ts')).toMatch(/Math\.max\(0, Math\.trunc\(opts\.offset as number\)\)/);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts')).toMatch(/offset: opts\.offset,/);
  });

  it('the listing has a total, stable order — paging over an arbitrary one skips and repeats rows', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts');
    const block = repo.slice(repo.indexOf('async findPublicViewList'));
    expect(block).toMatch(/orderBy: \[desc\(products\.createdAt\), asc\(products\.id\)\]/);
  });
});

describe('the images arriving this week are actually shown', () => {
  it('a suggestion carries its primary image', () => {
    const src = read('apps/api/src/application/use-cases/products/SearchUseCases.ts');
    expect(src).toMatch(/imageUrl: string \| null;/);
    expect(src).toMatch(/imageUrl: primaryImageUrl\(c\.row\.images\)/);
    expect(src).toMatch(/Number\(b\.isPrimary\) - Number\(a\.isPrimary\)/);
  });

  it('the dropdown renders it rather than a hard-coded blank', () => {
    expect(read('apps/web/src/components/GpNav.astro')).toMatch(/i: p\.imageUrl \|\| null/);
  });
});
