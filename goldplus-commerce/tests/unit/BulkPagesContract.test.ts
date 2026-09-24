import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_FORM_BUDGETS, budgetedFormPath } from '../../apps/web/src/lib/publicFormLimiter';

/**
 * Source contracts for the bulk buying pages (docs/bulk-buying/DESIGN.md).
 * The storefront pages read public facts only; nothing dealer-, cost- or
 * floor-shaped may appear in them. CSP: no inline handlers, and any inline
 * script carries the request nonce.
 */
const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const STOREFRONT_FILES = [
  'apps/web/src/pages/bulk/index.astro',
  'apps/web/src/pages/bulk/submitted.astro',
  'apps/web/src/pages/bulk/status.astro',
  'apps/web/src/components/bulk/BulkRequestSummary.astro',
  'apps/web/src/lib/bulkList.ts',
  'apps/web/src/lib/bulkCatalogue.ts',
  'apps/web/src/lib/bulkBuilderClient.ts',
  'apps/web/src/lib/bulkQuoteView.ts',
  'apps/web/src/pages/api/bulk/cart.ts',
  'apps/web/src/pages/api/bulk/quote.ts',
];
const ALL_ASTRO = [
  ...STOREFRONT_FILES.filter((f) => f.endsWith('.astro')),
  'apps/web/src/pages/admin/quotes/index.astro',
  'apps/web/src/pages/admin/quotes/[id].astro',
];

describe('bulk pages disclose public facts only', () => {
  it.each(STOREFRONT_FILES)('%s names no dealer price, cost or floor', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/dealerPrice|dealer_price|costPrice|cost_price|supplierCost|floorPrice|floor_price|priceFloor/);
  });

  it('the builder never prints a stock count', () => {
    const src = read('apps/web/src/pages/bulk/index.astro');
    expect(src).not.toMatch(/availability\.quantity|stockQuantity|\.quantity\s*\}/);
    expect(read('apps/web/src/lib/bulkCatalogue.ts')).not.toMatch(/availability\??\.quantity/);
  });

  it('the estimate is labelled as an estimate with volume pricing confirmed by the team', () => {
    const src = read('apps/web/src/pages/bulk/index.astro');
    expect(src).toContain('Estimated total at list price');
    expect(src).toContain('Volume pricing is confirmed by our sales team');
    expect(read('apps/web/src/components/bulk/BulkRequestSummary.astro')).toContain('not a bill');
  });

  it('the quote relay forwards ids and quantities, never a client price, name or code', () => {
    const src = read('apps/web/src/pages/api/bulk/quote.ts');
    const linesMap = src.slice(src.indexOf('body.lines ='), src.indexOf('let upstream'));
    expect(linesMap).toContain('productId');
    expect(linesMap).toContain('quantity');
    expect(linesMap).not.toMatch(/price|name|code/i);
  });
});

describe('CSP', () => {
  it.each(ALL_ASTRO)('%s has no inline on*= handlers', (file) => {
    expect(read(file)).not.toMatch(/\son[a-z]+\s*=\s*["{]/i);
  });

  it.each(ALL_ASTRO)('%s: every inline script carries the request nonce', (file) => {
    const src = read(file);
    for (const m of src.matchAll(/<script(?=[\s>])([^>]*)>/g)) {
      const attrs = m[1];
      if (/is:inline|define:vars|set:html/.test(attrs)) expect(attrs).toMatch(/nonce=\{Astro\.locals\.cspNonce\}/);
    }
  });

  it('the client module writes data with textContent, never innerHTML', () => {
    expect(read('apps/web/src/lib/bulkBuilderClient.ts')).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });
});

describe('abuse budgets and discovery', () => {
  it('the quote, the status lookup and the basket add are budgeted per visitor', () => {
    expect(budgetedFormPath('/api/bulk/quote')).toBe('/api/bulk/quote');
    expect(budgetedFormPath('/Bulk/Status/')).toBe('/bulk/status');
    expect(budgetedFormPath('/api/bulk/cart')).toBe('/api/bulk/cart');
    expect(PUBLIC_FORM_BUDGETS['/api/bulk/quote'].limit).toBeLessThanOrEqual(PUBLIC_FORM_BUDGETS['/quote-request'].limit);
  });

  it('the builder is linked from the quote and dealer pages and listed in the sitemap', () => {
    expect(read('apps/web/src/pages/quote-request.astro')).toContain('href="/bulk"');
    expect(read('apps/web/src/pages/dealers/apply.astro')).toMatch(/href="\/bulk[?"]/);
    expect(read('apps/web/src/pages/dealers/dashboard.astro')).toMatch(/href="\/bulk[?"]/);
    expect(read('apps/web/src/lib/sitemap.ts')).toContain("'/bulk',");
  });

  it('the buyer pages that show a request are not indexed and not cached', () => {
    for (const file of ['apps/web/src/pages/bulk/submitted.astro', 'apps/web/src/pages/bulk/status.astro']) {
      const src = read(file);
      expect(src).toContain('robotsMeta="noindex,nofollow"');
      expect(src).toContain("'Cache-Control', 'no-store'");
    }
  });

  it('the receipt cookie is httpOnly and scoped to /bulk', () => {
    const src = read('apps/web/src/pages/api/bulk/quote.ts');
    expect(src).toMatch(/httpOnly:\s*true/);
    expect(src).toMatch(/path:\s*'\/bulk'/);
  });
});

describe('migration 0153', () => {
  const dir = 'apps/api/src/infrastructure/db/migrations';
  it('is journalled right after 0152 and is additive', () => {
    const journal = JSON.parse(read(`${dir}/meta/_journal.json`)) as { entries: Array<{ idx: number; tag: string; when: number }> };
    const i = journal.entries.findIndex((e) => e.tag === '0153_bulk_quote_lines');
    expect(i).toBeGreaterThan(0);
    expect(journal.entries[i - 1].tag).toBe('0152_delivery_learning_inputs');
    expect(journal.entries[i].idx).toBe(153);
    expect(journal.entries[i].when).toBeGreaterThan(journal.entries[i - 1].when);
    const sql = read(`${dir}/0153_bulk_quote_lines.sql`);
    const statements = sql.split('--> statement-breakpoint').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean);
    for (const st of statements) {
      expect(st).toMatch(/^(ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS|CREATE TABLE IF NOT EXISTS)/);
      // Additive: a new NOT NULL column must carry a default so existing rows stay valid.
      if (st.startsWith('ALTER TABLE') && /NOT NULL/.test(st)) expect(st).toMatch(/DEFAULT/);
    }
  });
});

describe('the email acknowledgement copy is unchanged', () => {
  it('the QUOTE_REQUEST_RECEIVED template is not given any bulk wording', () => {
    const tpl = read('apps/api/templates/email/templates/customer-QUOTE_REQUEST_RECEIVED.html');
    expect(tpl).not.toMatch(/lineCount|line_count|bulk/i);
  });
});
