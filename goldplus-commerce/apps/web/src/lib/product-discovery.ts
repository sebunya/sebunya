import type { ProductPublicDto } from '@goldplus/shared';
import { DEFAULT_TAXONOMY, type Taxonomy } from '@goldplus/shared';

/**
 * Product discovery. The taxonomy (categories, subcategories, inference keywords,
 * aliases) is operator-editable and passed in from the DB; every function
 * defaults to DEFAULT_TAXONOMY so pure-function callers and tests behave exactly
 * as before. Discovery matches products by categoryName + keyword inference, so
 * it never touches the products↔categories FK.
 */

// Back-compat: the original hardcoded constant is now the default document.
export const DISCOVERY_TAXONOMY = DEFAULT_TAXONOMY;

export type DiscoveryCategorySlug = string;
export type DiscoverySubcategorySlug = string;
export type DiscoverySort = 'default' | 'price-low-high' | 'price-high-low' | 'name-a-z';

const VALID_SORTS = new Set<DiscoverySort>(['default', 'price-low-high', 'price-high-low', 'name-a-z']);

function aliasMap(taxonomy: Taxonomy): Record<string, string> {
  const out: Record<string, string> = {};
  for (const category of taxonomy) {
    for (const alias of category.aliases ?? []) out[alias.toLowerCase()] = category.slug;
  }
  return out;
}

export function normalizeSearchParam(value: string | null): string {
  return (value ?? '')
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 || character === '<' || character === '>' ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

export function normalizeCategoryParam(value: string | null, taxonomy: Taxonomy = DEFAULT_TAXONOMY): DiscoveryCategorySlug | '' {
  const candidate = (value ?? '').trim().toLowerCase();
  const canonical = aliasMap(taxonomy)[candidate] ?? candidate;
  return taxonomy.some((item) => item.slug === canonical) ? canonical : '';
}

export function normalizeSubcategoryParam(
  value: string | null,
  category: DiscoveryCategorySlug | '',
  taxonomy: Taxonomy = DEFAULT_TAXONOMY,
): DiscoverySubcategorySlug | '' {
  if (!category) return '';
  const candidate = (value ?? '').trim().toLowerCase();
  const categoryEntry = taxonomy.find((item) => item.slug === category);
  return categoryEntry?.subcategories.some((item) => item.slug === candidate) ? candidate : '';
}

export function normalizeSortParam(value: string | null): DiscoverySort {
  const legacy: Record<string, DiscoverySort> = {
    featured: 'default',
    price_low_high: 'price-low-high',
    price_high_low: 'price-high-low',
    name_az: 'name-a-z',
  };
  const candidate = legacy[value ?? ''] ?? value;
  return VALID_SORTS.has(candidate as DiscoverySort) ? candidate as DiscoverySort : 'default';
}

export function categoryNameForSlug(slug: DiscoveryCategorySlug | '', taxonomy: Taxonomy = DEFAULT_TAXONOMY): string {
  return taxonomy.find((item) => item.slug === slug)?.name ?? '';
}

export function subcategoryNameForSlug(slug: DiscoverySubcategorySlug | '', taxonomy: Taxonomy = DEFAULT_TAXONOMY): string {
  for (const category of taxonomy) {
    const match = category.subcategories.find((item) => item.slug === slug);
    if (match) return match.name;
  }
  return '';
}

/** Escape a keyword and match it as a word-boundary phrase (spaces → flexible whitespace). */
function keywordMatches(keyword: string, haystack: string): boolean {
  const escaped = keyword.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  if (!escaped) return false;
  return new RegExp('\\b' + escaped).test(haystack);
}

export function getProductSubcategory(product: ProductPublicDto, taxonomy: Taxonomy = DEFAULT_TAXONOMY): DiscoverySubcategorySlug | '' {
  const searchable = `${product.name} ${product.categoryName}`.toLowerCase();
  // Longest matching keyword wins, so a specific phrase ("car charger") beats a
  // generic one ("charger") regardless of category order.
  let best = '';
  let bestLen = 0;
  for (const category of taxonomy) {
    for (const sub of category.subcategories) {
      for (const keyword of sub.keywords ?? []) {
        if (keyword.length > bestLen && keywordMatches(keyword, searchable)) {
          best = sub.slug;
          bestLen = keyword.length;
        }
      }
    }
  }
  return best;
}

export function dedupeProductsById(products: ProductPublicDto[]): ProductPublicDto[] {
  const seen = new Set<string>();
  return products.filter((product) => {
    if (!product?.id || seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
}

/**
 * Everything the shop may list. Taxonomy membership decides which CATEGORY a
 * product browses under — it must not decide whether the product exists.
 * `categories` holds fewer categories than the taxonomy, so a product filed
 * under one the storefront does not browse by (today "Other") was dropped from
 * the shop, from search and from every count: approved, active, in stock and
 * invisible. It now lists, and simply appears under no category chip until it
 * is filed under one.
 */
export function isListableProduct(product: ProductPublicDto): boolean {
  return Boolean(product && product.slug && product.name);
}

export function isApprovedDiscoveryProduct(product: ProductPublicDto, taxonomy: Taxonomy = DEFAULT_TAXONOMY): boolean {
  return taxonomy.some((category) => category.name === product.categoryName);
}

export function matchesDiscoveryQuery(product: ProductPublicDto, query: string, taxonomy: Taxonomy = DEFAULT_TAXONOMY): boolean {
  if (!query) return true;
  const subcategory = subcategoryNameForSlug(getProductSubcategory(product, taxonomy), taxonomy);
  const haystack = [product.name, product.categoryName, subcategory, product.sku, product.modelNumber]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase('en');
  // Every word must appear, in any order, so "bank power" finds the power bank.
  // A one-word query is the old substring behaviour exactly, and a phrase can
  // only match MORE than before, never less. Kept in step with the API's
  // searchTerms so the header suggestions and this page agree.
  const terms = query.toLocaleLowerCase('en').split(/\s+/).filter(Boolean).slice(0, 6);
  return terms.every((term) => haystack.includes(term));
}

export function filterDiscoveryProducts(
  products: ProductPublicDto[],
  filters: { search: string; category: DiscoveryCategorySlug | ''; subcategory: DiscoverySubcategorySlug | '' },
  taxonomy: Taxonomy = DEFAULT_TAXONOMY,
): ProductPublicDto[] {
  const categoryName = categoryNameForSlug(filters.category, taxonomy);
  return dedupeProductsById(products)
    // Listable, not "in the taxonomy": a product filed under a category the
    // storefront does not browse by must still be findable. The category and
    // subcategory filters below already restrict what a chip shows.
    .filter(isListableProduct)
    .filter((product) => !categoryName || product.categoryName === categoryName)
    .filter((product) => !filters.subcategory || getProductSubcategory(product, taxonomy) === filters.subcategory)
    .filter((product) => matchesDiscoveryQuery(product, filters.search, taxonomy));
}

export function sortDiscoveryProducts(products: ProductPublicDto[], sort: DiscoverySort, taxonomy: Taxonomy = DEFAULT_TAXONOMY): ProductPublicDto[] {
  const list = [...products];
  const safePrice = (product: ProductPublicDto) =>
    typeof product.retailPriceUgx === 'number' && Number.isFinite(product.retailPriceUgx) && product.retailPriceUgx > 0
      ? product.retailPriceUgx
      : Number.POSITIVE_INFINITY;
  if (sort === 'price-low-high') return list.sort((a, b) => safePrice(a) - safePrice(b) || a.name.localeCompare(b.name));
  if (sort === 'price-high-low') return list.sort((a, b) => safePrice(b) - safePrice(a) || a.name.localeCompare(b.name));
  if (sort === 'name-a-z') return list.sort((a, b) => a.name.localeCompare(b.name));
  // Default: the order the shop is BROWSED in — taxonomy category, then
  // subcategory, then name — never creation time. "Newest first" put the
  // 89 batteries, imported last, on the first four pages of the shop.
  const categoryRank = new Map(taxonomy.map((c, i) => [c.name, i]));
  const subRank = new Map<string, number>();
  taxonomy.forEach((c) => c.subcategories.forEach((sc, i) => subRank.set(sc.slug, i)));
  const rank = (p: ProductPublicDto) => [categoryRank.get(p.categoryName) ?? taxonomy.length, subRank.get(getProductSubcategory(p, taxonomy)) ?? 999] as const;
  return list.sort((a, b) => {
    const [ca, sa] = rank(a); const [cb, sb] = rank(b);
    return ca - cb || sa - sb || a.name.localeCompare(b.name);
  });
}
