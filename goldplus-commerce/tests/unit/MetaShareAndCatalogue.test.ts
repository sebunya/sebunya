import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { jpegRendition } from '../../packages/shared/src/media/jpegRendition';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

describe('what Facebook, Instagram and WhatsApp read from a product', () => {
  it('a product photo that leaves the site for Meta is its JPEG rendition; anything else is left alone', () => {
    expect(jpegRendition('https://shopgoldplus.com/uploads/assets/1c/1c02cbb25091/pdp.webp')).toBe('https://shopgoldplus.com/uploads/assets/1c/1c02cbb25091/pdp.jpg');
    expect(jpegRendition('/uploads/assets/1c/1c02cbb25091/card.avif?v=2')).toBe('/uploads/assets/1c/1c02cbb25091/card.jpg?v=2');
    for (const same of ['/og-default.png', '/uploads/pb.webp', '/uploads/assets/1c/1c02cbb25091/goldplus-usb-sound-card.webp', 'https://example.com/a/pdp.webp', '/uploads/assets/1c/1c02cbb25091/pdp.jpg']) {
      expect(jpegRendition(same)).toBe(same);                            // no JPEG twin is known to exist
    }
  });
  it('the variant generator still writes a JPEG for every rendition (the twin the helper names)', () => {
    const gen = read('apps/api/src/infrastructure/media/SharpVariantGenerator.ts');
    expect(gen).toMatch(/purpose: 'pdp'/);
    expect(gen).toMatch(/\.jpeg\(\{ quality: 80/);
  });
  it('a product page says it is a product: the id the feed and the events use, its price and whether it can be bought', () => {
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    expect(layout).toContain('<meta property="og:type" content={ogProduct ? "product" : "website"} />');
    for (const tag of ['product:retailer_item_id', 'product:price:amount', 'product:price:currency', 'product:availability', 'product:condition', 'product:brand']) expect(layout).toContain(`property="${tag}"`);
    expect(layout).toContain('const shareImage = jpegRendition(');
    const pdp = read('apps/web/src/pages/products/[slug].astro');
    // The same id as the events (item_id) and the catalogue feed; the price the page charges, sale included.
    expect(pdp).toContain("product={product && pdpHasPrice ? { id: product.id, priceUgx: pdpOnSale ? pdpSaleUgx! : product.retailPriceUgx!, inStock: product.availability.kind === 'in_stock' } : undefined}");
  });
});
