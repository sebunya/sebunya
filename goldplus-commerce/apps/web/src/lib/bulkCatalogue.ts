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
 * public catalogue. Only public facts: a list price, a yes/no stock state
 * (never a count), and the codes a buyer would type. No floor, no dealer price,
 * no cost ever reaches this shape.
 */
export interface BulkRow {
  productId: string;
  slug: string;
  name: string;
  /** SKU, else model number; shown and matched on paste. */
  code: string | null;
  sku: string | null;
  modelNumber: string | null;
  unitPriceUgx: number | null;
  inStock: boolean;
  /** Pre-order / not tracked: we do not claim either way. */
  stockLabel: 'In stock' | 'Out of stock' | 'Pre-order' | 'Ask us';
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

export function stockLabelOf(availability: ProductPublicDto['availability'] | undefined): BulkRow['stockLabel'] {
  switch (availability?.kind) {
    case 'in_stock':
      return 'In stock';
    case 'out_of_stock':
      return 'Out of stock';
    case 'pre_order':
      return 'Pre-order';
    default:
      return 'Ask us';
  }
}

export function toBulkRows(products: ProductPublicDto[], taxonomy: Taxonomy): BulkRow[] {
  const clean = dedupeProductsById(getCleanCatalog(products, taxonomy)).filter(isListableProduct);
  const categorySlugByName = new Map(taxonomy.map((c) => [c.name, c.slug]));
  const rows = clean.map((p): BulkRow => {
    const subSlug = getProductSubcategory(p, taxonomy);
    const price = typeof p.retailPriceUgx === 'number' && p.retailPriceUgx > 0 ? p.retailPriceUgx : null;
    return {
      productId: p.id,
      slug: p.slug,
      name: p.name,
      code: p.sku ?? p.modelNumber ?? null,
      sku: p.sku ?? null,
      modelNumber: p.modelNumber ?? null,
      unitPriceUgx: price,
      inStock: p.availability?.kind === 'in_stock',
      stockLabel: stockLabelOf(p.availability),
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
