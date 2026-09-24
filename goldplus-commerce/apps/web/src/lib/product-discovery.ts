import type { ProductPublicDto } from '@goldplus/shared';
import { DEFAULT_TAXONOMY, includesSearchTerm, inferSubcategory, type Taxonomy } from '@goldplus/shared';

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

/**
 * Keyword inference lives in @goldplus/shared (inferSubcategory) so the header
 * dropdown infers exactly the subcategory this page does.
 */
export function getProductSubcategory(product: ProductPublicDto, taxonomy: Taxonomy = DEFAULT_TAXONOMY): DiscoverySubcategorySlug | '' {
  return inferSubcategory(product, taxonomy)?.slug ?? '';
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

/**
 * A shopper knows their PHONE, not the battery's pack code, and a listing often
 * names only the phone line ("fits the Spark 4") without the maker. So a brand
 * word in the query is also satisfied by that brand's own phone lines. Only
 * lines that belong to one maker are listed: "Note" (Infinix, Redmi, Galaxy)
 * and bare letters (itel's A-series, Oppo's A-series) would match the wrong
 * brand's batteries, so they are left out. This widens search only; nothing is
 * displayed from it, and a word that is not there still excludes the product.
 */
export const PHONE_BRAND_LINES: Readonly<Record<string, RegExp>> = {
  tecno: /\b(?:spark|camon|pova|phantom|pop\s?\d)/,
  infinix: /\b(?:hot|zero|smart)\s?\d/,
  samsung: /\bgalaxy\b/,
  xiaomi: /\b(?:redmi|poco)\b/,
  apple: /\biphone/,
  huawei: /\b(?:mate|nova)\s?\d/,
  oppo: /\breno\s?\d/,
};

function termMatches(term: string, haystack: string): boolean {
  // Shared with the API so "2gb" never finds 32GB in either engine.
  if (includesSearchTerm(haystack, term)) return true;
  // Own keys only: a query word like "constructor" must not reach the prototype.
  return Object.prototype.hasOwnProperty.call(PHONE_BRAND_LINES, term) && PHONE_BRAND_LINES[term].test(haystack);
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
  return terms.every((term) => termMatches(term, haystack));
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

/**
 * `preferredCategories` (the visitor's own interest, strongest first) only
 * moves whole categories to the front of the DEFAULT browse order. It never
 * touches an order the shopper chose, never hides anything, and within a
 * category the order is the same for everyone.
 */
export function sortDiscoveryProducts(products: ProductPublicDto[], sort: DiscoverySort, taxonomy: Taxonomy = DEFAULT_TAXONOMY, preferredCategories: readonly string[] = []): ProductPublicDto[] {
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
  const preferred = preferredCategories.map((slug) => normalizeCategoryParam(slug, taxonomy)).filter(Boolean);
  const ordered = [...taxonomy].sort((a, b) => {
    const pa = preferred.indexOf(a.slug); const pb = preferred.indexOf(b.slug);
    return (pa < 0 ? Infinity : pa) - (pb < 0 ? Infinity : pb) || taxonomy.indexOf(a) - taxonomy.indexOf(b);
  });
  const categoryRank = new Map(ordered.map((c, i) => [c.name, i]));
  const subRank = new Map<string, number>();
  taxonomy.forEach((c) => c.subcategories.forEach((sc, i) => subRank.set(sc.slug, i)));
  const rank = (p: ProductPublicDto) => [categoryRank.get(p.categoryName) ?? taxonomy.length, subRank.get(getProductSubcategory(p, taxonomy)) ?? 999] as const;
  return list.sort((a, b) => {
    const [ca, sa] = rank(a); const [cb, sb] = rank(b);
    return ca - cb || sa - sb || a.name.localeCompare(b.name);
  });
}
