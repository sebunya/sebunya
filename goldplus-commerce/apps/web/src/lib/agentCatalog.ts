import type { ProductPublicDto } from '@goldplus/shared';
import { apiBase } from './api';
import { chargedPriceUgx, realProductImageUrls } from './productStructuredData';
import type { StorefrontDiscount } from './storefrontDiscount';
import { SITE_ORIGIN } from './sitemap';

/**
 * The one shape every machine-facing surface (the MCP server, llms-full.txt)
 * uses for a product, so an assistant reading any of them is told the same
 * facts the product page shows.
 *
 * Deliberately left out: the discount floor (floorPriceUgx) and anything else
 * the shop uses to price internally. The price given is what a customer is
 * charged today, campaign included — the same chargedPriceUgx the page uses.
 */
export interface AgentProduct {
  name: string;
  url: string;
  sku: string | null;
  model: string | null;
  category: string;
  price_ugx: number | null;
  availability: ProductPublicDto['availability']['kind'];
  summary: string | null;
  specifications: Record<string, string | number>;
  images: string[];
}

export function agentProduct(p: ProductPublicDto, discount: StorefrontDiscount | null): AgentProduct {
  return {
    name: p.name,
    url: `${SITE_ORIGIN}/products/${p.slug}`,
    sku: p.sku,
    model: p.modelNumber,
    category: p.categoryName,
    price_ugx: chargedPriceUgx(p, discount),
    availability: p.availability.kind,
    summary: p.shortDescription,
    specifications: p.verifiedSpecs ?? {},
    images: realProductImageUrls(p).map((u) => (u.startsWith('http') ? u : `${SITE_ORIGIN}${u}`)),
  };
}

export const AVAILABILITY_TEXT: Record<AgentProduct['availability'], string> = {
  in_stock: 'In stock',
  out_of_stock: 'Out of stock',
  pre_order: 'Pre-order',
  unknown: 'Stock not confirmed — ask the shop',
};

async function getJson<T>(path: string, timeoutMs = 4000): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T } | null;
    return json?.success ? (json.data ?? null) : null;
  } catch {
    return null;
  }
}

/** The public catalogue search the shop page uses (name, SKU, model, description). */
export async function searchCatalogue(opts: { query?: string; category?: string; inStockOnly?: boolean; limit: number }): Promise<ProductPublicDto[] | null> {
  const qs = new URLSearchParams({ limit: String(opts.limit) });
  if (opts.query) qs.set('q', opts.query);
  if (opts.category) qs.set('category', opts.category);
  if (opts.inStockOnly) qs.set('inStock', 'true');
  return getJson<ProductPublicDto[]>(`/products?${qs.toString()}`);
}

export async function productBySlug(slug: string): Promise<ProductPublicDto | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(slug)) return null;
  return getJson<ProductPublicDto>(`/products/${encodeURIComponent(slug)}`);
}

/** The battery finder's own search: verified/provisional fits only, never a guess. */
export async function batteryFinderSearch(query: string): Promise<unknown> {
  return getJson<unknown>(`/batteries/finder/search?q=${encodeURIComponent(query.slice(0, 120))}`);
}
