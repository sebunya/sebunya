import { describe, expect, it } from 'vitest';
import { modelToolText, SYSTEM_PROMPT } from '../../apps/web/src/lib/assistant';

/** Goldie can only compare what she can see: the specs travel with every search result, and a missing one says so. */
describe('search results carry the verified specs', () => {
  const out = { structuredContent: { products: [
    { name: 'GoldPlus GP-P07 20000mAh Power Bank', url: 'https://shopgoldplus.com/products/gp-p07', price_ugx: 130000, availability: 'in_stock', sku: 'GP-P07-PB', specifications: { Capacity: '20000 mAh', 'Output power': '22.5 W', 'Built-in cables': 'USB-C, Lightning', Colour: 'Black' } },
    { name: 'GoldPlus GP-X01 Power Bank', url: 'https://shopgoldplus.com/products/gp-x01', price_ugx: 260000, availability: 'in_stock', sku: 'GP-X01-PB', specifications: {} },
  ] } };
  it('shows capacity/output on the line, drops colour, and marks an empty sheet as not confirmed', () => {
    const t = modelToolText('search_products', out as never)!;
    expect(t).toContain('specs: Capacity 20000 mAh; Output power 22.5 W; Built-in cables USB-C, Lightning');
    expect(t).not.toContain('Colour');
    expect(t).toMatch(/GP-X01[^\n]*specs: not confirmed by the shop/);
  });
  it('the instructions say: needs first, no unproven superlatives, never infer a spec', () => {
    expect(SYSTEM_PROMPT).toMatch(/Find out what they need before you recommend/);
    expect(SYSTEM_PROMPT).toMatch(/Never say "most", "best", "cheapest"/);
    expect(SYSTEM_PROMPT).toMatch(/never work a spec out from the name, the price or the photo/);
  });
});
