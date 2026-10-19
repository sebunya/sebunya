import type { ProductPublicDto, Taxonomy } from '@goldplus/shared';
import { getCleanCatalog } from './catalog/catalog';
import {
  dedupeProductsById,
  getProductSubcategory,
  isListableProduct,
  subcategoryNameForSlug,
} from './product-discovery';

/**
 * One row of the bulk order builder (/bulk), built on the server from the
 * public catalogue and the bulk terms. How the product is bought (carton of N,
 * or by the piece) is public. The bulk price is present only when the visitor
 * proved their phone (lib/bulkAccess); otherwise it is null. Bulk is supplied
 * to order, so no stock state is shown. No floor or cost reaches this shape.
 */
export interface BulkRow {
  productId: string;
  slug: string;
  name: string;
  /** SKU, else model number; shown and matched on paste. */
  code: string | null;
  sku: string | null;
  modelNumber: string | null;
  bulkUnit: 'carton' | 'piece';
  unitsPerCarton: number | null;
  /** Per piece; null when locked or not set. */
  bulkPriceUgx: number | null;
  categorySlug: string;
  categoryName: string;
  subcategorySlug: string;
  subcategoryName: string;
  imageUrl: string | null;
}

export interface BulkFilterGroup {
  slug: string;
  name: string;
  count: number;
  subcategories: Array<{ slug: string; name: string; count: number }>;
}

/** A product's bulk terms as the API gives them (POST /quotes/bulk-terms). */
export interface BulkTermsRow {
  productId: string;
  bulkUnit: 'carton' | 'piece';
  unitsPerCarton: number | null;
  bulkPriceUgx?: number | null;
}

export function toBulkRows(products: ProductPublicDto[], taxonomy: Taxonomy, terms: ReadonlyMap<string, BulkTermsRow> = new Map()): BulkRow[] {
  const clean = dedupeProductsById(getCleanCatalog(products, taxonomy)).filter(isListableProduct);
  const categorySlugByName = new Map(taxonomy.map((c) => [c.name, c.slug]));
  const rows = clean.map((p): BulkRow => {
    const subSlug = getProductSubcategory(p, taxonomy);
    const t = terms.get(p.id.toLowerCase());
    const price = typeof t?.bulkPriceUgx === 'number' && t.bulkPriceUgx > 0 ? t.bulkPriceUgx : null;
    return {
      productId: p.id,
      slug: p.slug,
      name: p.name,
      code: p.sku ?? p.modelNumber ?? null,
      sku: p.sku ?? null,
      modelNumber: p.modelNumber ?? null,
      bulkUnit: t?.bulkUnit === 'piece' ? 'piece' : 'carton',
      unitsPerCarton: t?.bulkUnit === 'piece' ? null : (typeof t?.unitsPerCarton === 'number' && t.unitsPerCarton > 1 ? t.unitsPerCarton : null),
      bulkPriceUgx: price,
      categorySlug: categorySlugByName.get(p.categoryName) ?? 'other',
      categoryName: categorySlugByName.has(p.categoryName) ? p.categoryName : 'Other',
      subcategorySlug: subSlug,
      subcategoryName: subSlug ? subcategoryNameForSlug(subSlug, taxonomy) : '',
      imageUrl: p.primaryImageUrl ?? null,
    };
  });
  // Category (taxonomy order), then name: a stable list a buyer can scan.
  const order = new Map(taxonomy.map((c, i) => [c.slug, i]));
  return rows.sort((a, b) =>
    (order.get(a.categorySlug) ?? 999) - (order.get(b.categorySlug) ?? 999) || a.name.localeCompare(b.name),
  );
}

export function filterGroups(rows: BulkRow[], taxonomy: Taxonomy): BulkFilterGroup[] {
  const groups: BulkFilterGroup[] = [];
  const known = [...taxonomy.map((c) => ({ slug: c.slug, name: c.name })), { slug: 'other', name: 'Other' }];
  for (const cat of known) {
    const inCat = rows.filter((r) => r.categorySlug === cat.slug);
    if (inCat.length === 0) continue;
    const subs = new Map<string, { slug: string; name: string; count: number }>();
    for (const r of inCat) {
      if (!r.subcategorySlug) continue;
      const s = subs.get(r.subcategorySlug) ?? { slug: r.subcategorySlug, name: r.subcategoryName, count: 0 };
      s.count += 1;
      subs.set(r.subcategorySlug, s);
    }
    groups.push({ slug: cat.slug, name: cat.name, count: inCat.length, subcategories: [...subs.values()] });
  }
  return groups;
}

/** Lower-case text the client filter searches: name, codes, category, subcategory. */
export function searchTextOf(row: BulkRow): string {
  return [row.name, row.sku, row.modelNumber, row.categoryName, row.subcategoryName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
