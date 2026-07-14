import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISCOVERY_TAXONOMY } from '../../apps/web/src/lib/product-discovery';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const homepage = read('apps/web/src/pages/index.astro');
const shop = read('apps/web/src/pages/shop.astro');

describe('Slice 02 storefront P0 protected contract', () => {
  it('keeps the approved public category taxonomy', () => {
    expect(DISCOVERY_TAXONOMY.map((category) => category.name)).toEqual([
      'Power Devices', 'Sound Devices', 'Storage Devices', 'Car Accessories',
    ]);
  });

  it('keeps clear public routes into the shop and verification journey', () => {
    expect(homepage).toContain('href="/shop"');
    expect(homepage).toContain('Shop all products');
    expect(homepage).toContain('href="/verification"');
    expect(shop).toContain('Browse categories');
  });

  it('keeps storefront truth language and honest empty states', () => {
    expect(homepage).toContain('No Fake Claims');
    expect(homepage).toContain("If a spec isn't verified, we tell you it's missing.");
    expect(shop).toContain('No matching products yet.');
    expect(shop).toContain('not personalised recommendations');
  });
});
