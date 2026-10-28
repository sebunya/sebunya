import { apiBase } from './api';
import { getBusinessInfo } from './businessInfo';
import { fetchApprovedCatalogueWithStatus } from './catalogue';
import { getStorefrontDiscount } from './storefrontDiscount';
import { SITE_ORIGIN } from './sitemap';
import { AVAILABILITY_TEXT, agentProduct, batteryFinderSearch, productBySlug, searchCatalogue, type AgentProduct } from './agentCatalog';
import { getProductQuestions } from './questions';

/**
 * The shop's read-only agent tools: ONE implementation behind the public MCP
 * server (/mcp), the in-browser WebMCP tools and the site's own chat assistant
 * (/api/assistant/chat). Prices, stock and the internal-field filter are the
 * ones the storefront applies; nothing here writes, orders, or reads a customer.
 */
export type Json = Record<string, unknown>;

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS = [
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
      'The GoldPlus battery finder: give a phone model (e.g. "Tecno Spark 7", "Samsung A03") or a battery code (e.g. "BL-49FT"). Every fit states its source (checked by GoldPlus, or listed by the supplier); it never guesses, and says so when a phone is not matched. A customer can have the fit confirmed on WhatsApp before ordering.',
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

export const INSTRUCTIONS =
  'GoldPlus is an electronics accessories shop in Kampala, Uganda (website https://shopgoldplus.com). Prices are in Ugandan shillings (UGX) and are what the shop charges today. ' +
  'Use search_products to find items and get_product for details; quote prices and specifications from the tool results rather than inferring them. ' +
  'For replacement batteries use find_battery: each fit states its source (checked by GoldPlus, or the supplier\'s compatibility list) and nothing is guessed. Buying happens on the product page link.';



/** Never let an internal pricing field reach an agent, whatever an upstream shape adds later. */
export function publicOnly(value: unknown): unknown {
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

export function toolText(data: unknown, text: string, isError = false): Json {
  const structured = publicOnly(data) as Json;
  return { content: [{ type: 'text', text }], structuredContent: structured, ...(isError ? { isError: true } : {}) };
}

const priceLine = (p: AgentProduct) =>
  `- ${p.name} — ${p.price_ugx != null ? `UGX ${p.price_ugx.toLocaleString('en-UG')}` : 'price on request'} — ${AVAILABILITY_TEXT[p.availability]}${p.sku ? ` — SKU ${p.sku}` : ''} — ${p.url}`;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function callTool(name: string, args: Json): Promise<Json> {
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
      // 0208: what the team already answered about this product, so Goldie says the same as the shop would.
      const answered = (await getProductQuestions(p.id).catch(() => [])).slice(0, 6).map((q) => ({ question: q.question.slice(0, 200), answer: q.answer.slice(0, 400) }));
      const product = { ...agentProduct(p, discount), description: p.longDescription, teamAnswers: answered };
      const specs = Object.entries(product.specifications).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
      const qa = answered.map((q) => `  - Q: ${q.question}\n    A: ${q.answer}`).join('\n');
      const text = [priceLine(product), product.summary ?? '', specs ? `Specifications:\n${specs}` : '', qa ? `Questions the GoldPlus team has answered about this product (treat as the shop's own word):\n${qa}` : ''].filter(Boolean).join('\n');
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
          : `Result for "${q}" (${kind}). Each fit states its source (checked by GoldPlus, or the supplier's compatibility list); a customer can have it confirmed on WhatsApp before ordering. Battery finder: ${SITE_ORIGIN}/battery-finder`;
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


export type ToolName = (typeof TOOLS)[number]['name'];
export const isToolName = (name: string): name is ToolName => TOOLS.some((t) => t.name === name);
