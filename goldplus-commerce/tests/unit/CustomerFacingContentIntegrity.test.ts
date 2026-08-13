import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Customer-facing content integrity.
 *
 * A public page showing invented business data is worse than a missing page.
 * /dealers/dashboard shipped a hard-coded "Sample Dealer Store" with
 * UGX 4,200,000 in sales, 42 stock items and account DLR-123 — publicly
 * reachable and indexable, with no dealer backend behind it. Nothing caught it
 * because no test looked at what customers actually see.
 *
 * This sweep derives the page list from disk, so a future page is covered the
 * moment it exists.
 */

const root = resolve(__dirname, '../..');
const pagesRoot = resolve(root, 'apps/web/src/pages');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/** Every storefront page. Admin is internal and excluded deliberately. */
const customerPages = walk(pagesRoot)
  .filter((p) => p.endsWith('.astro'))
  .map((p) => relative(root, p).replaceAll('\\', '/'))
  .filter((p) => !p.includes('/pages/admin/'))
  .sort();

const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Strip comments — a comment explaining a past defect is not a live claim. */
const withoutComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('no customer-facing page invents business data', () => {
  it('discovers the storefront page inventory from disk', () => {
    expect(customerPages.length).toBeGreaterThan(20);
    expect(customerPages).toContain('apps/web/src/pages/dealers/dashboard.astro');
  });

  it('states no invented money figure', () => {
    // A hard-coded currency amount in a page is either a real price (which
    // must come from the catalogue) or an invented one.
    for (const page of customerPages) {
      const src = withoutComments(read(page));
      const matches = src.match(/UGX\s?[\d,]{4,}/g) ?? [];
      expect(matches, `${page} hard-codes a money figure: ${matches.join(', ')}`).toEqual([]);
    }
  });

  it('names no invented account, customer or dealer identity', () => {
    const forbidden = /Sample (Dealer|Store|Customer|Order)|DLR-\d+|John Doe|Jane Doe|Acme\b/;
    for (const page of customerPages) {
      const src = withoutComments(read(page));
      expect(src, `${page} contains an invented identity`).not.toMatch(forbidden);
    }
  });

  it('ships no internal programme jargon to the browser', () => {
    // Astro frontmatter stays server-side, but an `is:inline` script is
    // delivered verbatim — "Slice 4" means nothing to anyone outside the build.
    for (const page of customerPages) {
      const src = read(page);
      for (const [, block] of src.matchAll(/<script[^>]*is:inline[^>]*>([\s\S]*?)<\/script>/g)) {
        expect(block, `${page} ships internal jargon in an inline script`).not.toMatch(/\bSlice \d|\bWave \d|\bPhase \d\b/i);
      }
    }
  });

  it('keeps mock/dummy fixtures out of the storefront', () => {
    for (const page of customerPages) {
      const src = withoutComments(read(page));
      expect(src, `${page} references a mock/dummy fixture`).not.toMatch(/\b(mock|dummy)\s*(data|dealer|customer|order|product)\b/i);
    }
  });
});

describe('the dealer dashboard tells the truth about what exists', () => {
  const page = read('apps/web/src/pages/dealers/dashboard.astro');

  it('no longer renders a fabricated dealer account', () => {
    const live = withoutComments(page);
    expect(live).not.toMatch(/Sample Dealer Store|DLR-123|UGX 4,200,000/);
    expect(live).not.toMatch(/totalSales|stockItems|pendingVerifications/);
  });

  it('says plainly that no self-service portal exists', () => {
    expect(page).toMatch(/does not yet offer a self-service dealer portal/i);
  });

  it('routes the visitor to channels that actually work', () => {
    expect(page).toContain('href="/dealers/apply"');
    expect(page).toContain('href="/support"');
  });

  it('is noindex — an account utility page has nothing to rank for', () => {
    expect(page).toContain('robotsMeta="noindex,follow"');
  });
});
