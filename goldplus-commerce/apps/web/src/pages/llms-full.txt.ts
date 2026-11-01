import type { APIRoute } from 'astro';
import { apiBase } from '../lib/api';
import { getBusinessInfo } from '../lib/businessInfo';
import { fetchApprovedCatalogueWithStatus } from '../lib/catalogue';
import { getStorefrontDiscount } from '../lib/storefrontDiscount';
import { SITE_ORIGIN } from '../lib/sitemap';
import { AVAILABILITY_TEXT, agentProduct } from '../lib/agentCatalog';

/**
 * /llms-full.txt — the whole catalogue as one Markdown document, for an
 * assistant that wants every product in a single read rather than following
 * links from /llms.txt. Generated from the live catalogue at the prices the
 * shop charges today (agentProduct: the page's own price, no internal fields).
 *
 * Same rule as /llms.txt: only a COMPLETE catalogue read is published. A
 * partial read would state a short product list as the shop's full range, so
 * it is answered 503 and retried, never cached.
 */
export const GET: APIRoute = async () => {
  const [biz, read, discount] = await Promise.all([
    getBusinessInfo(),
    fetchApprovedCatalogueWithStatus(apiBase).catch(() => ({ products: [], complete: false })),
    getStorefrontDiscount(),
  ]);
  if (!read.complete || read.products.length === 0) {
    return new Response('# GoldPlus\n\n> The catalogue could not be read in full just now. Please retry shortly, or see https://shopgoldplus.com/llms.txt.\n', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' },
    });
  }

  const byCategory = new Map<string, ReturnType<typeof agentProduct>[]>();
  for (const p of read.products) {
    const ap = agentProduct(p, discount);
    const list = byCategory.get(ap.category) ?? [];
    list.push(ap);
    byCategory.set(ap.category, list);
  }
  const one = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

  const lines: string[] = [
    '# GoldPlus — full catalogue',
    '',
    `> Every product GoldPlus lists online (${read.products.length}), with the price charged today in Ugandan shillings, stock state, verified specifications and the page to buy it. GoldPlus is a shop at ${one(biz.addressLine1).replace(/\.$/, '')}${/uganda/i.test(biz.addressLine1) ? '' : ', Uganda'}; open ${one(biz.openDays)}, ${one(biz.shopHours)}; phone and WhatsApp ${one(biz.phoneDisplay)}.`,
    '',
    `Short version: [llms.txt](${SITE_ORIGIN}/llms.txt). Live tools for assistants: [MCP server](${SITE_ORIGIN}/mcp) and [developer notes](${SITE_ORIGIN}/developers).`,
    '',
  ];
  for (const [category, products] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${category}`, '');
    for (const p of products.sort((a, b) => a.name.localeCompare(b.name))) {
      const price = p.price_ugx != null ? `UGX ${p.price_ugx.toLocaleString('en-UG')}` : 'price on request';
      lines.push(`### [${p.name}](${p.url})`, '');
      lines.push(`- Price: ${price}`, `- Availability: ${AVAILABILITY_TEXT[p.availability]}`);
      if (p.sku) lines.push(`- SKU: ${p.sku}`);
      if (p.model) lines.push(`- Model: ${p.model}`);
      for (const [k, v] of Object.entries(p.specifications)) lines.push(`- ${one(k)}: ${one(String(v))}`);
      if (p.summary) lines.push('', one(p.summary));
      lines.push('');
    }
  }

  return new Response(lines.join('\n'), {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
};
