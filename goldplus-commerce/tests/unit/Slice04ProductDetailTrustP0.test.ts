import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const pdp = read('apps/web/src/pages/products/[slug].astro');
const card = read('apps/web/src/components/ProductCard.astro');
const productTrust = `${pdp}\n${card}`;

describe('Slice 04 product detail trust P0 protected contract', () => {
  it('keeps truthful price fallbacks', () => {
    expect(pdp).toContain('Price on request.');
    expect(card).toContain('Number.isFinite(product.retailPriceUgx)');
    expect(card).toContain('Price on request');
  });

  it('keeps safe availability language and only enables purchase for in-stock products', () => {
    expect(pdp).toContain("unknown: 'Stock not confirmed'");
    expect(pdp).toContain("const canBuy = product?.availability.kind === 'in_stock'");
    expect(card).toContain("default: return 'Confirm availability'");
  });

  it('publishes only verified attributes and identifies missing specifications', () => {
    expect(pdp).toContain('product.attributeValues.filter((v) => v.isVerified');
    expect(pdp).toContain('No specifications published yet.');
  });

  it('does not invent warranty, delivery or universal compatibility guarantees', () => {
    expect(productTrust).not.toMatch(/free returns|replacement guarantee|same-day delivery guarantee|works with all devices|compatible with every device|\d+[- ](?:day|month|year) warranty/i);
  });
});
