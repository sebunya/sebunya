import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { schemaAvailability } from '../../apps/web/src/lib/jsonld';

/**
 * The shop and hub listings told search engines OutOfStock for every product that was not in_stock: an unverified
 * stock level and a pre-order included, while the product page said PreOrder or nothing. A stock claim nobody had
 * verified, contradicting the product page in Merchant Center.
 */
describe('one availability rule for every product JSON-LD', () => {
  it('maps the three known kinds and leaves an unknown out', () => {
    expect(schemaAvailability('in_stock')).toBe('https://schema.org/InStock');
    expect(schemaAvailability('out_of_stock')).toBe('https://schema.org/OutOfStock');
    expect(schemaAvailability('pre_order')).toBe('https://schema.org/PreOrder');
    for (const k of ['unknown', '', null, undefined, 'something_new']) expect(schemaAvailability(k as never)).toBeNull();
  });

  it('the product page and both listings use it, and no listing hard-codes OutOfStock any more', () => {
    for (const f of ['components/ProductJsonLd.astro', 'pages/shop.astro', 'pages/[hub]/[...child].astro']) {
      const src = readFileSync(join(__dirname, '../../apps/web/src', f), 'utf8');
      expect(src, f).toMatch(/schemaAvailability\(/);
      expect(src, f).not.toMatch(/: 'https:\/\/schema\.org\/OutOfStock'/);
    }
  });
});
