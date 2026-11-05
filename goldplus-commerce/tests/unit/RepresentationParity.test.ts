import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * A5 + N9: the Markdown for agents and the HTML JSON-LD describe ONE product
 * the same way on the semantic fields (seller, identity, price, availability),
 * a missing or unpublished product yields no Markdown document (the request
 * falls through to the HTML 404/410/redirect), and awkward catalogue text
 * (quotes, ampersands, newlines, non-ASCII, missing optional fields) still
 * produces valid frontmatter and a parseable JSON block. Synthetic fixtures.
 */
const base = {
  id: '00000000-0000-4000-8000-0000000000a5', slug: 'zz-test-bank', name: 'GoldPlus "Mega" Bank & Cable – Ünïcode 10000mAh',
  categoryName: 'Power & Cables', shortDescription: 'Line one\nLine "two" & <three>', longDescription: null,
  sku: 'ZZ-TEST-1', modelNumber: 'ZZ 1', retailPriceUgx: 12345, floorPriceUgx: null,
  availability: { kind: 'in_stock' }, hasImage: false, primaryImageUrl: null, verifiedSpecs: {}, hasMissingSpecs: true,
  images: [], attributeValues: [],
} as any;

let routes: Record<string, { status: number; body: unknown }>;
beforeEach(() => {
  routes = {};
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const u = String(input);
    const hit = Object.entries(routes).find(([k]) => u.includes(k));
    if (!hit) return new Response(JSON.stringify({ success: false }), { status: 404 });
    return new Response(JSON.stringify(hit[1].body), { status: hit[1].status });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

const jsonBlock = (md: string) => {
  const m = md.match(/```json\n([\s\S]*?)\n```/);
  return m ? JSON.parse(m[1]) : null;
};

describe('Markdown vs HTML product representation', () => {
  it('the Markdown Offer names the same seller as the HTML Offer (one helper)', async () => {
    const { productJsonLd } = await import('../../apps/web/src/lib/agentDocuments');
    const { offerSellerJsonLd } = await import('../../apps/web/src/lib/productStructuredData');
    const { SITE_ORIGIN } = await import('../../apps/web/src/lib/sitemap');
    const node: any = productJsonLd(base, null);
    expect(node.offers.seller).toEqual(offerSellerJsonLd(SITE_ORIGIN));
    expect(node.offers.seller['@id']).toBe(`${SITE_ORIGIN}/#organization`);
    const html = readFileSync('apps/web/src/components/ProductJsonLd.astro', 'utf8');
    expect(html).toMatch(/seller: offerSellerJsonLd\(SITE_ORIGIN\)/);
    expect(html).toMatch(/publishableIdentifier\(product\.sku\)/);
  });

  it('placeholder SKU/model are left out of both, never published as identity', async () => {
    const { productJsonLd } = await import('../../apps/web/src/lib/agentDocuments');
    const node: any = productJsonLd({ ...base, sku: 'Needs Business Confirmation', modelNumber: 'model pending' }, null);
    expect(node.sku).toBeUndefined();
    expect(node.mpn).toBeUndefined();
  });

  it('awkward text round-trips: frontmatter stays one line, JSON parses, values intact', async () => {
    routes['/products/zz-test-bank'] = { status: 200, body: { success: true, data: base } };
    const { agentDocumentFor } = await import('../../apps/web/src/lib/agentDocuments');
    const md = await agentDocumentFor(new URL('https://shopgoldplus.com/products/zz-test-bank'));
    expect(md).toBeTruthy();
    const front = md!.split('---')[1];
    expect(front).toContain('title: "GoldPlus \\"Mega\\" Bank & Cable – Ünïcode 10000mAh"');
    expect(front.trim().split('\n')).toHaveLength(2);
    const ld = jsonBlock(md!);
    expect(ld.name).toBe(base.name);
    expect(ld.description).toBe(base.shortDescription);
    expect(ld.offers).toMatchObject({ price: 12345, priceCurrency: 'UGX', availability: 'https://schema.org/InStock' });
    expect(ld.image).toBeUndefined();
  });

  it('a product with no price publishes no Offer rather than a zero price', async () => {
    const { productJsonLd } = await import('../../apps/web/src/lib/agentDocuments');
    const node: any = productJsonLd({ ...base, retailPriceUgx: null }, null);
    expect(node.offers).toBeUndefined();
  });

  it('a missing product yields no Markdown (falls through to the HTML 404)', async () => {
    const { agentDocumentFor } = await import('../../apps/web/src/lib/agentDocuments');
    expect(await agentDocumentFor(new URL('https://shopgoldplus.com/products/zz-no-such-product'))).toBeNull();
  });

  it('an unpublished/retired product yields no Markdown (falls through to the HTML lifecycle answer)', async () => {
    routes['/products/zz-test-bank'] = { status: 200, body: { success: true, data: base } };
    routes['/seo/product-lifecycle'] = { status: 200, body: { success: true, data: { decided: true, outcome: { httpStatus: 410, indexable: false } } } };
    const { agentDocumentFor } = await import('../../apps/web/src/lib/agentDocuments');
    expect(await agentDocumentFor(new URL('https://shopgoldplus.com/products/zz-test-bank'))).toBeNull();
  });

  it('the Markdown is built from the URL alone (no cookie/session input), so its public cache is safe, and it varies on Accept', async () => {
    const { markdownResponse } = await import('../../apps/web/src/lib/agentMarkdown');
    const r = markdownResponse('# x');
    expect(r.headers.get('vary')).toBe('Accept');
    const mw = readFileSync('apps/web/src/middleware.ts', 'utf8');
    expect(mw).toMatch(/agentDocumentFor\(context\.url\)/);
    const docs = readFileSync('apps/web/src/lib/agentDocuments.ts', 'utf8');
    expect(docs).not.toMatch(/cookie|Authorization|goldplus_session/i);
  });

  it('N4: a public response that carries cookies is downgraded; an anonymous one keeps public caching', async () => {
    const { keepCookiesOutOfSharedCaches, hasPendingCookies } = await import('../../apps/web/src/lib/sharedCacheGuard');
    const { markdownResponse } = await import('../../apps/web/src/lib/agentMarkdown');
    const pending = { headers: function* () { yield 'goldplus_session=x; Path=/'; } };
    const none = { headers: function* () { /* nothing queued */ } };
    expect(hasPendingCookies(pending)).toBe(true);
    expect(hasPendingCookies(none)).toBe(false);
    expect(keepCookiesOutOfSharedCaches(markdownResponse('# x'), true).headers.get('cache-control')).toBe('private, no-store');
    expect(keepCookiesOutOfSharedCaches(markdownResponse('# x'), false).headers.get('cache-control')).toBe('public, max-age=900');
    const withCookie = new Response('gone', { status: 410, headers: { 'Cache-Control': 'public, max-age=300', 'Set-Cookie': 'a=1' } });
    expect(keepCookiesOutOfSharedCaches(withCookie, false).headers.get('cache-control')).toBe('private, no-store');
    const plain = new Response('x', { headers: { 'Cache-Control': 'no-store' } });
    expect(keepCookiesOutOfSharedCaches(plain, true).headers.get('cache-control')).toBe('no-store');
    const immutable = Response.redirect('https://shopgoldplus.com/', 301);
    expect(keepCookiesOutOfSharedCaches(immutable, true).status).toBe(301);
    const mw = readFileSync('apps/web/src/middleware.ts', 'utf8');
    expect(mw).toMatch(/response = keepCookiesOutOfSharedCaches\(response, hasPendingCookies\(context\.cookies\)\);\n  return withStrictScriptPolicyReport/);
  });

  it('N6: MCP get_product labels questions as shoppers\' words, keeps the shop answer on one line, and the public read caches only success', () => {
    const tools = readFileSync('apps/web/src/lib/agentTools.ts', 'utf8');
    expect(tools).toMatch(/Shopper asked: \$\{q\.question\}/);
    expect(tools).toMatch(/not product specifications/);
    expect(tools).toMatch(/q\.answer\.replace\(\/\\s\+\/g, ' '\)/);
    const route = readFileSync('apps/api/src/interfaces/http/routes/commerce.ts', 'utf8');
    const block = route.slice(route.indexOf("routes.get('/questions/products/:productId'"), route.indexOf("routes.post('/orders/lookup/followup'"));
    expect(block.indexOf('listAnswered')).toBeLessThan(block.indexOf("'public, max-age=120'"));
    expect(block).toMatch(/no-store/);
  });
});
