import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_FORM_BUDGETS, budgetedFormPath } from '../../apps/web/src/lib/publicFormLimiter';

/**
 * Source contracts for the bulk buying pages (docs/bulk-buying/DESIGN.md §12).
 * The storefront never names a dealer, cost or floor field: the bulk price
 * arrives as `bulkPriceUgx`, only from the API's gated read, only for a phone
 * proved by a texted code, and its token lives in an httpOnly cookie. Bulk is
 * supplied to order: no stock state and no basket route. CSP: no inline
 * handlers, and any inline script carries the request nonce.
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
  'apps/web/src/pages/api/bulk/quote.ts',
  'apps/web/src/lib/bulkAccess.ts',
  'apps/web/src/pages/api/bulk/access/start.ts',
  'apps/web/src/pages/api/bulk/access/verify.ts',
  'apps/web/src/pages/api/bulk/access/clear.ts',
];
const ALL_ASTRO = [
  ...STOREFRONT_FILES.filter((f) => f.endsWith('.astro')),
  'apps/web/src/pages/admin/quotes/index.astro',
  'apps/web/src/pages/admin/quotes/[id].astro',
  'apps/web/src/pages/admin/quotes/bulk-terms.astro',
  'apps/web/src/pages/admin/quotes/price-leads.astro',
];

describe('bulk pages disclose public facts only', () => {
  it.each(STOREFRONT_FILES)('%s names no dealer price, cost or floor', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/dealerPrice|dealer_price|costPrice|cost_price|supplierCost|floorPrice|floor_price|priceFloor/);
  });

  it('bulk is supplied to order: no stock state, no basket route', () => {
    const page = read('apps/web/src/pages/bulk/index.astro');
    expect(page).not.toMatch(/inStock|stockLabel|availability|stockQuantity|Add to basket/);
    expect(read('apps/web/src/lib/bulkCatalogue.ts')).not.toMatch(/availability\??\./);
    expect(read('apps/web/src/lib/bulkBuilderClient.ts')).not.toMatch(/\/api\/bulk\/cart|\/cart/);
    expect(fs.existsSync(path.join(ROOT, 'apps/web/src/pages/api/bulk/cart.ts'))).toBe(false);
  });

  it('the page shows bulk prices only when the API says the phone is verified, and is never cached', () => {
    const page = read('apps/web/src/pages/bulk/index.astro');
    expect(page).toContain('fetchBulkTerms(accessToken)');
    expect(page).toContain('const unlocked = bulkTerms.pricesUnlocked;');
    expect(page).toContain("'Cache-Control', 'private, no-store'");
    expect(page).toContain('if (!unlocked) return null;');
    // Locked rows carry no price text at all, not even a pointer to the panel.
    expect(page).not.toMatch(/Bulk price: enter your phone|see the total at bulk price/);
    // Rows take the price from the gated terms only, never the retail price.
    expect(read('apps/web/src/lib/bulkCatalogue.ts')).not.toMatch(/retailPriceUgx/);
  });

  it('the access token lives only in an httpOnly cookie; the browser never receives it', () => {
    const verify = read('apps/web/src/pages/api/bulk/access/verify.ts');
    expect(verify).toMatch(/httpOnly:\s*true/);
    expect(verify).toContain("data: { maskedPhone:");
    expect(verify).not.toMatch(/data:\s*\{[^}]*token/);
    // The script never reads or sends one (a comment may mention the cookie).
    expect(read('apps/web/src/lib/bulkBuilderClient.ts')).not.toMatch(/\.token\b|token\s*:|priceAccessToken|document\.cookie/);
    // The relay adds the token from the cookie, never from the request body.
    const relay = read('apps/web/src/pages/api/bulk/quote.ts');
    expect(relay).toContain('readAccessCookie(cookies.get(BULK_ACCESS_COOKIE)?.value)');
    expect(relay).not.toMatch(/raw\.priceAccessToken/);
  });

  it('the quote relay forwards ids and counts, never a client price, name or code', () => {
    const src = read('apps/web/src/pages/api/bulk/quote.ts');
    const linesMap = src.slice(src.indexOf('body.lines ='), src.indexOf('const accessToken'));
    expect(linesMap).toContain('productId');
    expect(linesMap).toContain('count');
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
  it('the request, the status lookup and both code steps are budgeted per visitor', () => {
    expect(budgetedFormPath('/api/bulk/quote')).toBe('/api/bulk/quote');
    expect(budgetedFormPath('/Bulk/Status/')).toBe('/bulk/status');
    expect(budgetedFormPath('/api/bulk/access/start')).toBe('/api/bulk/access/start');
    expect(budgetedFormPath('/api/bulk/access/verify')).toBe('/api/bulk/access/verify');
    expect(budgetedFormPath('/api/bulk/cart')).toBeNull();
    expect(PUBLIC_FORM_BUDGETS['/api/bulk/quote'].limit).toBeLessThanOrEqual(PUBLIC_FORM_BUDGETS['/quote-request'].limit);
    // Each code costs an SMS.
    expect(PUBLIC_FORM_BUDGETS['/api/bulk/access/start'].limit).toBeLessThanOrEqual(3);
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
