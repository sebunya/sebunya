import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISCOVERY_TAXONOMY } from '../../apps/web/src/lib/product-discovery';
import { DEFAULT_HOMEPAGE_CONTENT } from '@goldplus/shared';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const homepage = read('apps/web/src/pages/index.astro');
const shop = read('apps/web/src/pages/shop.astro');

describe('Slice 02 storefront P0 protected contract', () => {
  it('keeps the approved public category taxonomy', () => {
    // 2026-08-08: PC Accessories joined as the fifth category (the orphaned PC
    // category now has a taxonomy home instead of falling through discovery).
    expect(DISCOVERY_TAXONOMY.map((category) => category.name)).toEqual([
      'Power Devices', 'Sound Devices', 'Storage Devices', 'Car Accessories', 'PC Accessories',
    ]);
  });

  it('keeps clear public routes into the shop and verification journey', () => {
    // 2026-08-07: the hero moved from inline markup in index.astro into the
    // CMS-driven HeroSlider, whose content is the shared hero library. The
    // guarantee is unchanged — the homepage still routes to the shop and the
    // verification journey — but "Shop all products" and /verification now live
    // in the hero library rather than in the page source.
    const heroLibrary = read('packages/shared/src/hero/library.ts');
    expect(homepage).toContain('href="/shop"');
    expect(homepage + heroLibrary).toContain('Shop all products');
    expect(homepage + heroLibrary).toContain('/verification');
    expect(shop).toContain('Browse categories');
  });

  it('keeps storefront truth language and honest empty states', () => {
    // 2026-08-08: the homepage trust copy moved into the admin-editable
    // homepage_content document (DEFAULT_HOMEPAGE_CONTENT is the seed/fallback).
    // The guarantee is unchanged — unverified specs are marked missing, never
    // invented — it now lives in the default content rather than page source.
    const trustCopy = DEFAULT_HOMEPAGE_CONTENT.trustItems.map((t) => `${t.title} ${t.body}`).join(' ');
    expect(trustCopy).toContain('The spec you read is the spec you get');
    expect(trustCopy).toContain("If a detail isn't verified, we mark it missing.");
    expect(shop).toContain('No matching products yet.');
    expect(shop).toContain('not personalised recommendations');
  });
});
