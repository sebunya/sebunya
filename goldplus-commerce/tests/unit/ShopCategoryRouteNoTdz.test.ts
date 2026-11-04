import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 2026-11-04: a search equal to a category name ("chargers") answered 500 for 33 minutes in production. The Baymard Q2
 * route called shopUrl() from the frontmatter before facetSelection and preferredCategories were declared, so Astro threw
 * a ReferenceError (temporal dead zone) while rendering. The route now builds plain hrefs, and this pins the order.
 */
describe('the shop page never calls shopUrl before its inputs exist', () => {
  const page = readFileSync(resolve(__dirname, '../../apps/web/src/pages/shop.astro'), 'utf8');
  it('the category route builds its own href', () => {
    const block = page.slice(page.indexOf('const categoryRoute'), page.indexOf('const categoryRoute') + 1600);
    expect(block).not.toContain('shopUrl(');
    expect(block).toContain('`/shop?category=${encodeURIComponent(c.slug)}`');
  });
  it('every frontmatter call of shopUrl comes after facetSelection and preferredCategories are declared', () => {
    const fm = page.slice(0, page.indexOf('\n---\n', 4));
    const decl = Math.max(fm.indexOf('const facetSelection'), fm.indexOf('const preferredCategories'));
    expect(decl).toBeGreaterThan(0);
    const firstCall = fm.indexOf('shopUrl(', fm.indexOf('function shopUrl(') + 20);
    expect(firstCall === -1 || firstCall > decl, 'shopUrl is called in the frontmatter before its inputs are declared').toBe(true);
  });
});
