import { describe, expect, it } from 'vitest';
import { evaluateCrawlPolicy } from '../../apps/api/src/domain/seo/CrawlPolicy';
import { productJsonLd, breadcrumbJsonLd, faqPageJsonLd, serializeJsonLd, itemListJsonLd } from '../../apps/api/src/domain/seo/StructuredData';

describe('U6 crawl/facet policy (AC5)', () => {
  it('a category plus one filter is indexable', () => {
    const d = evaluateCrawlPolicy({ params: { brand: 'tecno' }, hasUniqueCopy: true });
    expect(d.robots).toBe('index,follow');
  });
  it('two or more filters get noindex, follow (AC5)', () => {
    const d = evaluateCrawlPolicy({ params: { brand: 'tecno', color: 'black' } });
    expect(d.index).toBe(false);
    expect(d.follow).toBe(true);
    expect(d.robots).toBe('noindex,follow');
  });
  it('sort, page size and view mode are always noindex and stripped from canonical', () => {
    const d = evaluateCrawlPolicy({ params: { brand: 'tecno', sort: 'price_desc', view: 'grid' }, hasUniqueCopy: true });
    expect(d.index).toBe(false);
    expect(d.canonicalParams).toEqual({ brand: 'tecno' });
  });
  it('pagination keeps a self-referencing canonical and stays indexable', () => {
    const d = evaluateCrawlPolicy({ params: { brand: 'tecno', page: '2' }, hasUniqueCopy: true });
    expect(d.index).toBe(true);
    expect(d.canonicalParams).toEqual({ brand: 'tecno', page: '2' });
  });
  it('an indexable facet without unique copy is not indexable', () => {
    const d = evaluateCrawlPolicy({ params: { brand: 'tecno' }, hasUniqueCopy: false });
    expect(d.index).toBe(false);
  });
});

describe('U6 structured data shapes (AC3)', () => {
  it('Product/Offer carries brand, priceValidUntil, shippingDetails, return policy and condition', () => {
    const node = productJsonLd({
      name: 'Charger', description: '20W USB-C', sku: 'SKU1', brand: 'GoldPlus', url: 'https://x/p/1',
      imageUrls: ['https://x/i.avif'], priceUgx: 50000, priceValidUntil: '2026-12-31', inStock: true,
      itemCondition: 'new', sellerName: 'GoldPlus', returnDays: 7,
    }) as any;
    expect(node['@type']).toBe('Product');
    expect(node.brand.name).toBe('GoldPlus');
    expect(node.offers.priceValidUntil).toBe('2026-12-31');
    expect(node.offers.availability).toBe('https://schema.org/InStock');
    expect(node.offers.itemCondition).toBe('https://schema.org/NewCondition');
    expect(node.offers.shippingDetails['@type']).toBe('OfferShippingDetails');
    expect(node.offers.hasMerchantReturnPolicy.merchantReturnDays).toBe(7);
  });
  it('BreadcrumbList, ItemList and FAQPage have correct positions', () => {
    const bc = breadcrumbJsonLd([{ name: 'Home', url: '/' }, { name: 'Chargers', url: '/c/chargers' }]) as any;
    expect(bc.itemListElement[1].position).toBe(2);
    const il = itemListJsonLd([{ name: 'A', url: '/a' }]) as any;
    expect(il.numberOfItems).toBe(1);
    const faq = faqPageJsonLd([{ question: 'Does it fit?', answer: 'Yes.' }]) as any;
    expect(faq.mainEntity[0]['@type']).toBe('Question');
  });
  it('serialization escapes script-breakout characters', () => {
    const out = serializeJsonLd({ x: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c');
  });
});
