import type { APIRoute } from 'astro';
import { apiBase } from '../lib/api';
import { getBusinessInfo } from '../lib/businessInfo';
import { fetchApprovedCatalogueWithStatus } from '../lib/catalogue';
import { getStorefrontDiscount } from '../lib/storefrontDiscount';
import { SITE_ORIGIN } from '../lib/sitemap';
import { AVAILABILITY_TEXT, agentProduct, batteryFinderSearch, productBySlug, searchCatalogue, type AgentProduct } from '../lib/agentCatalog';

/**
 * /mcp — a public, read-only Model Context Protocol server for the shop
 * (Streamable HTTP transport, stateless, JSON responses; no SSE stream).
 *
 * An assistant connected to it can search the catalogue, read a product, list
 * the categories, run the battery finder and read the shop's details: the same
 * public facts the storefront shows, from the same API, at the same prices.
 * Nothing here writes, places an order, reads a customer or sets a cookie;
 * buying stays on the website, where the customer sees and confirms the price.
 */

export const prerender = false;

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY_BYTES = 64 * 1024;
const SERVER_INFO = { name: 'goldplus-shop', title: 'GoldPlus shop (Kampala, Uganda)', version: '1.0.0', websiteUrl: SITE_ORIGIN };

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Max-Age': '86400',
};

// A small per-address budget: the tools fan out to the commerce API, and a
// public endpoint must not become a way to hammer it.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const calls = new Map<string, { start: number; n: number }>();
function allow(key: string): boolean {
  const now = Date.now();
  const cur = calls.get(key);
  if (!cur || now - cur.start > WINDOW_MS) {
    if (calls.size > 5000) calls.clear();
    calls.set(key, { start: now, n: 1 });
    return true;
  }
  cur.n += 1;
  return cur.n <= MAX_PER_WINDOW;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: 'search_products',
    title: 'Search GoldPlus products',
    description:
      'Search the GoldPlus catalogue (phone accessories, chargers, cables, power banks, earphones, storage, car and PC accessories, replacement phone batteries) by words, SKU or model number. Returns each product with its current price in Ugandan shillings (UGX), stock state and page link.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 120, description: 'Words to search for, e.g. "65W USB-C charger", "power bank 20000mAh" or a SKU such as "GP-C11".' },
        category: { type: 'string', maxLength: 80, description: 'Optional category slug from list_categories, e.g. "power-devices".' },
        in_stock_only: { type: 'boolean', description: 'Only return products that are in stock now.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
      },
      additionalProperties: false,
    },
    annotations: { title: 'Search GoldPlus products', ...READ_ONLY },
  },
  {
    name: 'get_product',
    title: 'Get one GoldPlus product',
    description: 'Full details of one product: price in UGX, stock, verified specifications, description, photos and page link. Pass the slug or the product page URL.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', maxLength: 200, description: 'The product slug, e.g. "goldplus-charger-gp-c11".' },
        url: { type: 'string', maxLength: 300, description: 'Or the product page URL, e.g. "https://shopgoldplus.com/products/goldplus-charger-gp-c11".' },
      },
      additionalProperties: false,
    },
    annotations: { title: 'Get one GoldPlus product', ...READ_ONLY },
  },
  {
    name: 'list_categories',
    title: 'List product categories',
    description: 'The categories GoldPlus sells in, with how many products each has and the slug to pass to search_products.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'List product categories', ...READ_ONLY },
  },
  {
    name: 'find_battery',
    title: 'Find a replacement phone battery',
    description:
      'The GoldPlus battery finder: give a phone model (e.g. "Tecno Spark 7", "Samsung A03") or a battery code (e.g. "BL-49FT"). It only returns fits GoldPlus has checked, says when a fit is unverified, and never guesses; GoldPlus confirms the fit before a customer pays.',
    inputSchema: {
      type: 'object',
      properties: { phone_or_code: { type: 'string', minLength: 2, maxLength: 120 } },
      required: ['phone_or_code'],
      additionalProperties: false,
    },
    annotations: { title: 'Find a replacement phone battery', ...READ_ONLY },
  },
  {
    name: 'store_info',
    title: 'GoldPlus shop details',
    description: 'Where the GoldPlus shop is in Kampala, opening hours, phone and WhatsApp, delivery terms and the pages for returns and warranty.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'GoldPlus shop details', ...READ_ONLY },
  },
] as const;

const INSTRUCTIONS =
  'GoldPlus is an electronics accessories shop in Kampala, Uganda (website https://shopgoldplus.com). Prices are in Ugandan shillings (UGX) and are what the shop charges today. ' +
  'Use search_products to find items and get_product for details; quote prices and specifications from the tool results rather than inferring them. ' +
  'For replacement batteries use find_battery: it only reports checked fits. Buying happens on the product page link.';

type Json = Record<string, unknown>;
type RpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

const rpcError = (id: unknown, code: number, message: string): Json => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const rpcResult = (id: unknown, result: Json): Json => ({ jsonrpc: '2.0', id, result });

/** Never let an internal pricing field reach an agent, whatever an upstream shape adds later. */
function publicOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicOnly);
  if (value && typeof value === 'object') {
    const out: Json = {};
    for (const [k, v] of Object.entries(value as Json)) {
      if (/floor|cost|supplier|dealer|margin/i.test(k)) continue;
      out[k] = publicOnly(v);
    }
    return out;
  }
  return value;
}

function toolText(data: unknown, text: string, isError = false): Json {
  const structured = publicOnly(data) as Json;
  return { content: [{ type: 'text', text }], structuredContent: structured, ...(isError ? { isError: true } : {}) };
}

const priceLine = (p: AgentProduct) =>
  `- ${p.name} — ${p.price_ugx != null ? `UGX ${p.price_ugx.toLocaleString('en-UG')}` : 'price on request'} — ${AVAILABILITY_TEXT[p.availability]}${p.sku ? ` — SKU ${p.sku}` : ''} — ${p.url}`;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function callTool(name: string, args: Json): Promise<Json> {
  switch (name) {
    case 'search_products': {
      const limit = Math.min(Math.max(Number.isInteger(args.limit) ? (args.limit as number) : 10, 1), 20);
      const query = str(args.query, 120);
      const category = str(args.category, 80).toLowerCase();
      if (category && !/^[a-z0-9-]+$/.test(category)) return toolText({ products: [] }, 'category must be a slug from list_categories, e.g. "power-devices".', true);
      const [found, discount] = await Promise.all([
        searchCatalogue({ query: query || undefined, category: category || undefined, inStockOnly: args.in_stock_only === true, limit }),
        getStorefrontDiscount(),
      ]);
      if (!found) return toolText({ products: [] }, 'The catalogue could not be read just now. Please try again, or browse https://shopgoldplus.com/shop.', true);
      const products = found.map((p) => agentProduct(p, discount));
      const text = products.length
        ? `${products.length} product${products.length === 1 ? '' : 's'}${query ? ` for "${query}"` : ''}:\n${products.map(priceLine).join('\n')}`
        : `No GoldPlus product matched${query ? ` "${query}"` : ''}. Try fewer words, a SKU, or list_categories.`;
      return toolText({ count: products.length, products }, text);
    }
    case 'get_product': {
      let slug = str(args.slug, 200);
      const url = str(args.url, 300);
      if (!slug && url) slug = url.match(/\/products\/([a-z0-9-]+)/)?.[1] ?? '';
      if (!slug) return toolText({}, 'Pass a product slug or a https://shopgoldplus.com/products/… URL.', true);
      const [p, discount] = await Promise.all([productBySlug(slug), getStorefrontDiscount()]);
      if (!p) return toolText({}, `No GoldPlus product has the slug "${slug}". Use search_products to find it.`, true);
      const product = { ...agentProduct(p, discount), description: p.longDescription };
      const specs = Object.entries(product.specifications).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
      const text = [priceLine(product), product.summary ?? '', specs ? `Specifications:\n${specs}` : ''].filter(Boolean).join('\n');
      return toolText({ product }, text);
    }
    case 'list_categories': {
      const read = await fetchApprovedCatalogueWithStatus(apiBase).catch(() => ({ products: [], complete: false }));
      if (!read.complete || read.products.length === 0) return toolText({ categories: [] }, 'The catalogue could not be read in full just now. Please try again.', true);
      const counts = new Map<string, number>();
      for (const p of read.products) counts.set(p.categoryName ?? 'Other', (counts.get(p.categoryName ?? 'Other') ?? 0) + 1);
      const categories = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => {
          const slug = name.toLowerCase().replace(/\s+/g, '-');
          return { name, slug, products: count, url: `${SITE_ORIGIN}/shop?category=${encodeURIComponent(slug)}` };
        });
      return toolText({ categories }, categories.map((c) => `- ${c.name} (${c.products}) — slug "${c.slug}" — ${c.url}`).join('\n'));
    }
    case 'find_battery': {
      const q = str(args.phone_or_code, 120);
      if (q.length < 2) return toolText({}, 'Give a phone model or a battery code (at least two characters).', true);
      const result = (await batteryFinderSearch(q)) as Json | null;
      if (!result) return toolText({}, 'The battery finder could not be reached just now. Please try again, or use https://shopgoldplus.com/battery-finder.', true);
      const { config: _config, ...rest } = result;
      const biz = await getBusinessInfo();
      const kind = String(rest.kind ?? '');
      const note =
        kind === 'NO_RESULT' || kind === 'SUGGESTIONS' || kind === 'AMBIGUOUS_DEVICE'
          ? `${String(rest.message ?? '')} GoldPlus can confirm the right battery on WhatsApp: ${biz.whatsappUrl}`
          : `Result for "${q}" (${kind}). Fits are only shown when GoldPlus has checked them; the fit is confirmed before payment. Battery finder: ${SITE_ORIGIN}/battery-finder`;
      return toolText({ ...rest, finder_url: `${SITE_ORIGIN}/battery-finder`, whatsapp: biz.whatsappUrl }, note.trim());
    }
    case 'store_info': {
      const biz = await getBusinessInfo();
      const info = {
        name: 'GoldPlus',
        website: SITE_ORIGIN,
        address: [biz.addressLine1, biz.addressLine2].map((s) => (s ?? '').trim().replace(/\.$/, '')).filter(Boolean).join(', '),
        map: biz.mapUrl,
        open: `${biz.openDays}, ${biz.shopHours}`,
        phone: biz.phoneDisplay,
        whatsapp: biz.whatsappUrl,
        delivery: `${biz.deliveryNote} Delivery runs ${biz.deliveryHours}.`,
        currency: 'UGX',
        pages: {
          shop: `${SITE_ORIGIN}/shop`,
          battery_finder: `${SITE_ORIGIN}/battery-finder`,
          faq: `${SITE_ORIGIN}/faq`,
          delivery: `${SITE_ORIGIN}/delivery/kampala-wakiso`,
          returns: `${SITE_ORIGIN}/returns`,
          warranty: `${SITE_ORIGIN}/warranty`,
        },
      };
      const text = `GoldPlus, ${info.address}. Open ${info.open}. Phone/WhatsApp ${info.phone}. ${info.delivery} Website ${SITE_ORIGIN}.`;
      return toolText(info, text);
    }
    default:
      return toolText({}, `Unknown tool "${name}".`, true);
  }
}

async function handle(msg: RpcRequest): Promise<Json | null> {
  const isNotification = msg.id === undefined;
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return isNotification ? null : rpcError(msg.id, -32600, 'Invalid Request');
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Json;
  switch (msg.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return isNotification ? null : rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: TOOLS as unknown as Json[] });
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!TOOLS.some((t) => t.name === name)) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Json;
      try {
        return rpcResult(msg.id, await callTool(name, args));
      } catch {
        return rpcResult(msg.id, toolText({}, 'The tool failed unexpectedly. Please try again.', true));
      }
    }
    default:
      if (isNotification) return null; // notifications/initialized and friends need no answer
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra } });

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!allow(clientAddress || 'unknown')) return json(rpcError(null, -32000, 'Too many requests; slow down.'), 429, { 'Retry-After': '60' });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(rpcError(null, -32600, 'Request too large'), 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0 || parsed.length > 20) return json(rpcError(null, -32600, 'Invalid Request'), 400);
    const out = (await Promise.all(parsed.map((m) => (m && typeof m === 'object' ? handle(m as RpcRequest) : rpcError(null, -32600, 'Invalid Request'))))).filter((r): r is Json => r !== null);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  // A JSON-RPC message is an object; a bare string or number is not a notification.
  if (!parsed || typeof parsed !== 'object') return json(rpcError(null, -32600, 'Invalid Request'), 400);
  const res = await handle(parsed as RpcRequest);
  return res ? json(res) : new Response(null, { status: 202, headers: CORS });
};

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });

// This server keeps no session and pushes no events, so there is no stream to
// open (GET) or close (DELETE): the transport answers 405 for both.
const notAllowed: APIRoute = () =>
  new Response(JSON.stringify({ error: 'This MCP endpoint takes JSON-RPC over POST (Streamable HTTP, stateless).', docs: `${SITE_ORIGIN}/developers` }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS', ...CORS },
  });
export const GET = notAllowed;
export const DELETE = notAllowed;
