import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prefersMarkdown, renderAgentMarkdown, estimateTokens, markdownResponse } from '../../apps/web/src/lib/agentMarkdown';

const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

/**
 * Cloudflare's Markdown for Agents needs a paid plan; this is the same
 * capability at the origin, generated from our data rather than converted from
 * HTML. The rules that keep it safe: browsers must never receive Markdown, and
 * a path we cannot represent must fall through to the real page.
 */
describe('markdown content negotiation', () => {
  it('serves markdown only when the client actually asks for it', () => {
    expect(prefersMarkdown('text/markdown')).toBe(true);
    expect(prefersMarkdown('text/markdown, text/html;q=0.5')).toBe(true);
    expect(prefersMarkdown('application/json, text/markdown;q=0.9')).toBe(true);
    // A browser: HTML first, wildcard fallback — must keep getting HTML.
    expect(prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe(false);
    expect(prefersMarkdown('*/*')).toBe(false);
    expect(prefersMarkdown(null)).toBe(false);
    expect(prefersMarkdown('text/markdown;q=0')).toBe(false);
    // Ranked below HTML: the client prefers HTML, so honour that.
    expect(prefersMarkdown('text/html, text/markdown;q=0.5')).toBe(false);
  });

  it('renders frontmatter, body and JSON-LD in Cloudflare\'s documented order', () => {
    const md = renderAgentMarkdown({
      title: 'GoldPlus GP-C10 100W Charger',
      description: 'A "fast" charger',
      body: '# GoldPlus GP-C10\n\n- **Price:** UGX 16,000',
      jsonLd: [{ '@type': 'Product', name: 'GP-C10' }],
    });
    expect(md.startsWith('---\ntitle: "GoldPlus GP-C10 100W Charger"\n')).toBe(true);
    expect(md).toContain('description: "A \\"fast\\" charger"');
    expect(md.indexOf('# GoldPlus GP-C10')).toBeGreaterThan(md.indexOf('---\ntitle'));
    expect(md.indexOf('```json')).toBeGreaterThan(md.indexOf('# GoldPlus GP-C10'));
    expect(md).toContain('{"@type":"Product","name":"GP-C10"}');
    // No frontmatter block at all when there is no metadata.
    expect(renderAgentMarkdown({ title: '', body: 'x' }).startsWith('x')).toBe(true);
  });

  it('reports token counts and keeps caches from mixing variants', async () => {
    const res = markdownResponse('# Title\n\nbody text');
    expect(res.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('Vary')).toBe('Accept');
    expect(res.headers.get('x-markdown-tokens')).toBe(String(estimateTokens('# Title\n\nbody text')));
    // Not reported: measuring it means rendering the HTML the agent skipped.
    expect(res.headers.get('x-original-tokens')).toBeNull();
    expect(res.headers.get('content-signal')).toBe('search=yes, ai-input=yes, ai-train=no');
  });

  it('does not render the HTML page it was asked to replace', () => {
    const mw = read('apps/web/src/middleware.ts');
    const block = mw.slice(mw.indexOf('if (wantsMarkdown)'), mw.indexOf('const adminPath'));
    // The old implementation called next() and read the body just to report a
    // token saving — doing the work the agent asked us to skip.
    expect(block).not.toContain('next()');
    expect(block).toContain('agentDocumentFor(context.url)');
  });

  it('advertises the markdown alternate only for paths it can actually serve', () => {
    const mw = read('apps/web/src/middleware.ts');
    expect(mw).toContain('agentRepresentablePath(path)');
    expect(mw).toContain('rel="alternate"; type="text/markdown"');
    expect(mw).toContain("response.headers.append('Vary', 'Accept')");
  });

  it('never applies to admin or API paths, and falls through when there is nothing to serve', () => {
    const mw = read('apps/web/src/middleware.ts');
    expect(mw).toContain("context.request.method === 'GET'");
    expect(mw).toContain("!context.url.pathname.startsWith('/admin')");
    expect(mw).toContain("!context.url.pathname.startsWith('/api/')");
    expect(mw).toContain('if (markdown) return markdownResponse(markdown);');
    expect(mw).toContain('} catch {');
  });

  it('the documents are built from live data, not scraped from the page', () => {
    const docs = read('apps/web/src/lib/agentDocuments.ts');
    expect(docs).toContain('fetchApprovedCatalogue');
    expect(docs).toContain('getBusinessInfo');
    expect(docs).toContain('RETURNS_POLICY.windowDays');
    expect(docs).toContain('p.verifiedSpecs');
    expect(docs).not.toMatch(/Wilson Road|0705 004545/);
  });

  it('reads the catalogue once for all list documents instead of per request', () => {
    const docs = read('apps/web/src/lib/agentDocuments.ts');
    expect(docs).toContain('CATALOGUE_TTL_MS');
    expect(docs).toContain('catalogueInflight');
    // Every list document goes through the cache, never straight to the fetch.
    const direct = docs.split('\n').filter((l) => l.includes('fetchApprovedCatalogue(apiBase)'));
    expect(direct.length).toBe(1);
  });

  it('carries the page\'s structured data and honours /shop filters', () => {
    const docs = read('apps/web/src/lib/agentDocuments.ts');
    expect(docs).toContain('jsonLd: [productJsonLd(p)]');
    expect(docs).toContain('hasMerchantReturnPolicy: merchantReturnPolicyJsonLd()');
    expect(docs).toContain('filterDiscoveryProducts(all, { search, category, subcategory }, taxonomy)');
    expect(docs).toContain('normalizeSortParam');
  });

  it('routes from one table, so discovery can never promise a document that does not exist', () => {
    const docs = read('apps/web/src/lib/agentDocuments.ts');
    // Both entry points read ROUTES; neither keeps its own path list.
    expect(docs).toContain('const route = ROUTES.find((r) => r.match(path));');
    expect(docs).toContain('return ROUTES.some((r) => r.match(path));');
    for (const marker of [
      "match: (p) => p === '/'", "match: (p) => p === '/faq'", "match: (p) => p === '/shop'",
      "match: (p) => p === '/battery-finder'", "match: (p) => p === '/returns'",
      "match: (p) => p === '/warranty'", "match: (p) => p === '/delivery/kampala-wakiso'",
      "match: (p) => p === '/blog'", '/^\\/blog\\/[^/]+$/', '/^\\/products\\/[^/]+$/', 'hubMatches(p)',
    ]) {
      expect(docs, marker).toContain(marker);
    }
  });

  it('an empty blog still answers in markdown rather than silently serving HTML', () => {
    const docs = read('apps/web/src/lib/agentDocuments.ts');
    expect(docs).toContain('has not published any guides yet');
    expect(docs).toContain('async function blogIndexDocument(): Promise<AgentDocument> {');
    // Falling through is reserved for an outage or a record that does not
    // exist — never for "this page has no content today".
    expect(docs).toContain('if (all.length === 0) return null;');
    expect(docs).toContain('the API did not answer');
  });

  it('an explicit ?page= returns that page, matching the HTML pagination', () => {
    const docs = read('apps/web/src/lib/agentDocuments.ts');
    expect(docs).toContain('const PAGE_SIZE = 24;');
    expect(docs).toContain("url.searchParams.get('page')");
    expect(docs).toContain('Next page:');
  });
});
