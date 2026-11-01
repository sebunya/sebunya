import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * /products/ is both the product-photo folder and the product PAGE prefix.
 * The Caddy @static matcher gives a 30-day browser cache; a bare /products/*
 * there cached every product page for a month, so a repriced product showed
 * its old price to anyone who had viewed it (found 2026-09-18).
 */
describe('product pages are never given the static 30-day cache', () => {
  const caddy = readFileSync(resolve(__dirname, '../../Caddyfile'), 'utf8');
  const staticLine = caddy.split('\n').find((l) => /^\s*@static\s+path\s/.test(l)) ?? '';

  it('finds the @static matcher', () => {
    expect(staticLine).not.toBe('');
  });

  it('scopes /products/ to image files only', () => {
    const tokens = staticLine.trim().split(/\s+/).slice(2);
    const products = tokens.filter((t) => t.startsWith('/products/'));
    expect(products.length).toBeGreaterThan(0);
    for (const t of products) expect(t).toMatch(/^\/products\/\*\.(webp|avif|svg|png|jpe?g)$/);
  });
});
