import type { ProductPublicDto, Taxonomy } from '@goldplus/shared';
import { getCleanCatalog } from './catalog/catalog';

/**
 * The category lines llms.txt states as facts: counted after the same normalisation the shop applies
 * (getCleanCatalog), and linked by the TAXONOMY slug the shop filters on. A category the taxonomy does not browse
 * by gets no link rather than a made-up one that lists nothing.
 */
export function llmsCategoryLines(products: ProductPublicDto[], taxonomy: Taxonomy, origin: string): Array<{ name: string; count: number; href: string | null }> {
  const byCategory = new Map<string, number>();
  for (const p of getCleanCatalog(products, taxonomy)) {
    const key = p.categoryName ?? 'Other';
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
  }
  return [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => {
      const entry = taxonomy.find((c) => c.name === name);
      return { name, count, href: entry ? `${origin}/shop?category=${encodeURIComponent(entry.slug)}` : null };
    });
}
