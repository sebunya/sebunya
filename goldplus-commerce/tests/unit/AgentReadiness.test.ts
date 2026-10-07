import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Agent readiness (2026-10-08): the public MCP server, llms-full.txt, the
 * OpenAPI description, the RFC 9727 api-catalog, the MCP server card, the
 * AI-crawler robots rules and the discovery Link headers. The endpoints are
 * executed, not just read: a server card or catalogue that answers wrong is
 * worse than none.
 */
const root = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const product = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'goldplus-charger-gp-c11',
  name: 'GoldPlus Charger GP-C11',
  categoryName: 'Power Devices',
  shortDescription: 'Three-port 30W charger.',
  longDescription: 'Long text.',
  sku: 'GP-C11',
  modelNumber: 'GP-C11',
  retailPriceUgx: 65000,
  floorPriceUgx: 50000,
  availability: { kind: 'in_stock', quantity: 4 },
  hasImage: true,
  primaryImageUrl: '/uploads/a/pdp.webp',
  verifiedSpecs: { Output: '30W' },
  hasMissingSpecs: false,
  images: [{ url: '/uploads/a/pdp.webp', alt: null }, { url: '/uploads/b/pdp.webp', alt: 'Sample view (same photo…)' }],
  attributeValues: [],
  ...over,
});

const catalogue = vi.fn();
const fetchMock = vi.fn();

vi.mock('../../apps/web/src/lib/api', () => ({ apiBase: 'http://api.test' }));
vi.mock('../../apps/web/src/lib/catalogue', () => ({ fetchApprovedCatalogueWithStatus: (...a: unknown[]) => catalogue(...a) }));
vi.mock('../../apps/web/src/lib/storefrontDiscount', () => ({ getStorefrontDiscount: async () => ({ active: false, percentBps: 0, priceFloorUgx: null }) }));
vi.mock('../../apps/web/src/lib/businessInfo', () => ({
  getBusinessInfo: async () => ({
    addressLine1: 'Zainab Aziza Building, 4th Floor, Burton Street, Kampala',
    addressLine2: 'Opposite Pioneer Mall',
    openDays: 'Monday to Saturday',
    shopHours: '8:30am to 6:00pm',
    phoneDisplay: '0705 004545',
    phoneDial: 'tel:+256705004545',
    whatsappUrl: 'https://wa.me/256705004545',
    mapUrl: 'https://maps.google.com/?cid=1',
    deliveryNote: 'Same-day in Kampala & Wakiso.',
    deliveryHours: '8:30am to 8:00pm',
    sameDayCutoffHour: 17,
  }),
}));

const rpc = async (body: unknown, clientAddress = '10.0.0.1') => {
  const { POST } = await import('../../apps/web/src/pages/mcp');
  const res = await (POST as any)({ request: new Request('https://shopgoldplus.com/mcp', { method: 'POST', body: JSON.stringify(body) }), clientAddress });
  return { status: res.status as number, json: res.status === 202 ? null : await res.json(), headers: res.headers as Headers };
};

beforeEach(() => {
  catalogue.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('MCP server (/mcp)', () => {
  it('initializes with a supported protocol version and announces tools only', async () => {
    const { json, headers } = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(json.result.protocolVersion).toBe('2025-06-18');
    expect(json.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(json.result.serverInfo.name).toBe('goldplus-shop');
    expect(headers.get('access-control-allow-origin')).toBe('*');
    const unknown = await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect(unknown.json.result.protocolVersion).toBe('2025-11-25');
  });

  it('answers a notification with 202 and no body; unknown methods with -32601', async () => {
    expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    expect((await rpc({ jsonrpc: '2.0', id: 3, method: 'resources/list' })).json.error.code).toBe(-32601);
    expect((await rpc('not json at all' as unknown)).json.error.code).toBe(-32600);
  });

  it('lists five read-only tools, matching the server card', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    const names = json.result.tools.map((t: any) => t.name);
    expect(names).toEqual(['search_products', 'get_product', 'list_categories', 'find_battery', 'store_info']);
    for (const t of json.result.tools) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.inputSchema.type).toBe('object');
    }
    const { serverCard } = await import('../../apps/web/src/pages/.well-known/mcp/server-card.json');
    expect(serverCard.tools).toEqual(names);
    expect(serverCard.remotes[0]).toEqual({ type: 'streamable-http', url: 'https://shopgoldplus.com/mcp' });
  });

  it('search_products returns the charged price, stock and page link — and never the price floor', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, data: [product()] })));
    const { json } = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'search_products', arguments: { query: 'charger', limit: 5 } } });
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://api.test/products?limit=5&q=charger');
    const p = json.result.structuredContent.products[0];
    expect(p).toMatchObject({ name: 'GoldPlus Charger GP-C11', price_ugx: 65000, availability: 'in_stock', url: 'https://shopgoldplus.com/products/goldplus-charger-gp-c11' });
    expect(p.images).toEqual(['https://shopgoldplus.com/uploads/a/pdp.webp']); // sample frames are not photos
    expect(JSON.stringify(json)).not.toMatch(/floor|50000/i);
    expect(json.result.content[0].text).toContain('UGX 65,000');
  });

  it('get_product accepts a page URL; an unknown slug is a tool error, not a crash', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: product() })));
    const ok = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_product', arguments: { url: 'https://shopgoldplus.com/products/goldplus-charger-gp-c11' } } });
    expect(ok.json.result.structuredContent.product.specifications).toEqual({ Output: '30W' });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    const missing = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_product', arguments: { slug: 'no-such-thing' } } });
    expect(missing.json.result.isError).toBe(true);
  });

  it('find_battery passes the finder through without its page config, and strips internal fields', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { kind: 'BATTERY', battery: { name: 'B', retailPriceUgx: 30000, floorPriceUgx: 20000 }, devices: [], query: 'BL-49FT', config: { headline: 'x' } } })));
    const { json } = await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'find_battery', arguments: { phone_or_code: 'BL-49FT' } } });
    expect(json.result.structuredContent.kind).toBe('BATTERY');
    expect(json.result.structuredContent.config).toBeUndefined();
    expect(json.result.structuredContent.battery.floorPriceUgx).toBeUndefined();
  });

  it('list_categories refuses to state counts from a partial catalogue read', async () => {
    catalogue.mockResolvedValue({ products: [product()], complete: false });
    const partial = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'list_categories', arguments: {} } });
    expect(partial.json.result.isError).toBe(true);
    catalogue.mockResolvedValue({ products: [product(), product({ slug: 'x' })], complete: true });
    const full = await rpc({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'list_categories', arguments: {} } });
    expect(full.json.result.structuredContent.categories).toEqual([{ name: 'Power Devices', slug: 'power-devices', products: 2, url: 'https://shopgoldplus.com/shop?category=power-devices' }]);
  });

  it('rate-limits one address and refuses GET with 405', async () => {
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await rpc({ jsonrpc: '2.0', id: i, method: 'ping' }, '10.9.9.9')).status;
    expect(last).toBe(429);
    const { GET } = await import('../../apps/web/src/pages/mcp');
    expect((await (GET as any)({})).status).toBe(405);
  });
});

describe('llms-full.txt', () => {
  it('publishes every product with its link and price, and 503s on a partial read', async () => {
    const { GET } = await import('../../apps/web/src/pages/llms-full.txt');
    catalogue.mockResolvedValue({ products: [product()], complete: false });
    expect((await (GET as any)({})).status).toBe(503);
    catalogue.mockResolvedValue({ products: [product()], complete: true });
    const res = await (GET as any)({});
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('### [GoldPlus Charger GP-C11](https://shopgoldplus.com/products/goldplus-charger-gp-c11)');
    expect(body).toContain('- Price: UGX 65,000');
    expect(body).not.toMatch(/50,000|floorPrice/i); // the address's "4th Floor" is fine
  });
});

describe('discovery documents', () => {
  it('api-catalog is an RFC 9727 linkset pointing at the OpenAPI and the MCP server', async () => {
    const { GET } = await import('../../apps/web/src/pages/.well-known/api-catalog');
    const res = await (GET as any)({});
    expect(res.headers.get('content-type')).toContain('application/linkset+json');
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('https://shopgoldplus.com/openapi.json');
    expect(JSON.stringify(body)).toContain('https://shopgoldplus.com/.well-known/mcp/server-card.json');
  });

  it('openapi documents only public read-only endpoints and never the price floor', async () => {
    const { GET } = await import('../../apps/web/src/pages/openapi.json');
    const spec = await (await (GET as any)({})).json();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toEqual(['/products', '/products/{slug}', '/batteries/finder/search']);
    for (const p of Object.values(spec.paths) as any[]) expect(Object.keys(p)).toEqual(['get']);
    expect(JSON.stringify(spec)).not.toMatch(/floorPrice/);
  });

  it('robots.txt names the AI crawlers in the SAME group as *, so every private path stays disallowed for them', () => {
    const src = read('apps/web/src/pages/robots.txt.ts');
    expect(src).toMatch(/'User-agent: \*\\n' \+\s*AI_CRAWLERS\.map/);
    for (const ua of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'OAI-SearchBot']) expect(src).toContain(`'${ua}'`);
    expect(src).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=yes');
    expect(src).toMatch(/Disallow: \/checkout/);
  });

  it('every HTML page advertises the api-catalog, the OpenAPI and llms.txt in Link headers', () => {
    const mw = read('apps/web/src/middleware.ts');
    expect(mw).toContain('rel="api-catalog"');
    expect(mw).toContain('rel="service-desc"');
    expect(mw).toContain('rel="describedby"');
  });

  it('llms.txt links the agent surfaces as markdown links', () => {
    const src = read('apps/web/src/pages/llms.txt.ts');
    expect(src).toContain('- [MCP server](${SITE_ORIGIN}/mcp)');
    expect(src).toContain('- [Full catalogue](${SITE_ORIGIN}/llms-full.txt)');
  });
});
