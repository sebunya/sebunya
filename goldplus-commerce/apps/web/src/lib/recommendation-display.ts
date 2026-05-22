import type { ProductPublicDto } from "@goldplus/shared";
import { STALE_SLUGS } from "./catalog/catalog";

export interface RecommendationItem {
  productId: string;
  slug: string;
  name: string;
  primaryImageUrl?: string | null;
  retailPriceUgx?: number | null;
  [key: string]: any;
}

/**
 * Dedupes a list of products by ID.
 */
export function dedupeRecommendations<T extends { id?: string; productId?: string; [key: string]: any }>(
  items: T[]
): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = item.id || item.productId;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Determines if a product meets safety and integrity requirements to be displayed as a recommendation.
 */
export function isDisplayableRecommendation(
  item: any
): boolean {
  if (!item) return false;
  const id = item.id || item.productId;
  const slug = item.slug;
  if (!id || !slug) return false;

  // Filter out any stale slugs from recommendations
  if (STALE_SLUGS.has(slug)) return false;

  // Requires a valid name
  if (!item.name || typeof item.name !== 'string' || item.name.trim().length === 0) return false;

  return true;
}

/**
 * Excludes specific product IDs from a dataset.
 */
export function excludeProductIds<T extends { id?: string; productId?: string; [key: string]: any }>(
  items: T[],
  excludeIds: string[]
): T[] {
  if (!excludeIds || excludeIds.length === 0) return items;
  const excludeSet = new Set(excludeIds.map(id => id.trim()).filter(Boolean));
  return items.filter(item => {
    const id = item.id || item.productId;
    return !id || !excludeSet.has(id);
  });
}

/**
 * Filters, dedupes, limits and cleans items based on display configuration.
 */
export function filterDisplayableRecommendations<T extends { id?: string; productId?: string; [key: string]: any }>(
  items: T[],
  opts: {
    excludeIds?: string[];
    limit?: number;
    currentProductId?: string;
  } = {}
): T[] {
  let processed = [...items];

  // Dedupe first
  processed = dedupeRecommendations(processed);

  // Exclude IDs list and current product
  const excludes = [...(opts.excludeIds || [])];
  if (opts.currentProductId) {
    excludes.push(opts.currentProductId);
  }
  processed = excludeProductIds(processed, excludes);

  // Verify basic display integrity
  processed = processed.filter(isDisplayableRecommendation);

  // Apply limit
  if (typeof opts.limit === 'number' && opts.limit > 0) {
    processed = processed.slice(0, opts.limit);
  }

  return processed;
}

/**
 * Evaluates whether a rail should render based on configured threshold bounds.
 */
export function shouldRenderRail<T>(items: T[], minItems = 2): boolean {
  return items && items.length >= minItems;
}
