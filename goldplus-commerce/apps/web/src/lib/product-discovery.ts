import type { ProductPublicDto } from '@goldplus/shared';
import {
  DEFAULT_TAXONOMY,
  buildSearchVocabulary,
  expandSearchQuery,
  includesSearchTerm,
  inferSubcategory,
  matchesExpandedQuery,
  relaxSearchQuery,
  type ExpandedSearchQuery,
  type Taxonomy,
} from '@goldplus/shared';

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

function discoveryHaystack(product: ProductPublicDto, taxonomy: Taxonomy): string {
  const subcategory = subcategoryNameForSlug(getProductSubcategory(product, taxonomy), taxonomy);
  return [product.name, product.categoryName, subcategory, product.sku, product.modelNumber]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase('en');
}

/**
 * `groups` come from expandSearchQuery (synonyms, plurals, joined words, typos). Without them every word must
 * appear as typed, in any order, so "bank power" finds the power bank — the behaviour before 2026-10-20, kept in
 * step with the API's searchTerms so the header suggestions and this page agree.
 */
export function matchesDiscoveryQuery(
  product: ProductPublicDto,
  query: string,
  taxonomy: Taxonomy = DEFAULT_TAXONOMY,
  groups?: readonly (readonly string[])[],
): boolean {
  if (!query) return true;
  const haystack = discoveryHaystack(product, taxonomy);
  const g = groups ?? query.toLocaleLowerCase('en').split(/\s+/).filter(Boolean).slice(0, 6).map((t) => [t]);
  return matchesExpandedQuery(haystack, g, termMatches);
}

/** The words a search can match in this catalogue: names, categories, subcategories, SKUs and models. */
export function discoveryVocabulary(products: ProductPublicDto[], taxonomy: Taxonomy = DEFAULT_TAXONOMY) {
  return buildSearchVocabulary([
    ...products.flatMap((p) => [p.name, p.categoryName, p.sku, p.modelNumber]),
    ...taxonomy.flatMap((c) => [c.name, ...c.subcategories.map((sc) => sc.name)]),
  ]);
}

export function expandDiscoveryQuery(products: ProductPublicDto[], query: string, taxonomy: Taxonomy = DEFAULT_TAXONOMY): ExpandedSearchQuery {
  const terms = query.toLocaleLowerCase('en').split(/\s+/).filter(Boolean).slice(0, 6);
  return expandSearchQuery(terms, discoveryVocabulary(products, taxonomy));
}

export function filterDiscoveryProducts(
  products: ProductPublicDto[],
  filters: { search: string; category: DiscoveryCategorySlug | ''; subcategory: DiscoverySubcategorySlug | '' },
  taxonomy: Taxonomy = DEFAULT_TAXONOMY,
  /** Already expanded (searchDiscoveryProducts passes the relaxed query); computed here otherwise. */
  groups?: readonly (readonly string[])[],
): ProductPublicDto[] {
  const categoryName = categoryNameForSlug(filters.category, taxonomy);
  const g = filters.search ? groups ?? expandDiscoveryQuery(products, filters.search, taxonomy).groups : undefined;
  return dedupeProductsById(products)
    // Listable, not "in the taxonomy": a product filed under a category the
    // storefront does not browse by must still be findable. The category and
    // subcategory filters below already restrict what a chip shows.
    .filter(isListableProduct)
    .filter((product) => !categoryName || product.categoryName === categoryName)
    .filter((product) => !filters.subcategory || getProductSubcategory(product, taxonomy) === filters.subcategory)
    .filter((product) => matchesDiscoveryQuery(product, filters.search, taxonomy, g));
}

export interface DiscoverySearchResult {
  products: ProductPublicDto[];
  /** What was searched for, in the catalogue's words ("power bank" for "powerbank"). */
  searchedFor: string;
  /** Typos fixed ("chager" -> "charger"): shown as "Showing results for …". */
  corrections: Array<{ from: string; to: string }>;
  /** Words dropped because nothing matched with them ("lapotp"): shown, never silent. */
  dropped: string[];
}

/**
 * The /shop search: the expanded query first; if that finds nothing and some words are unknown to the catalogue,
 * the same search without them, saying which words were dropped. Never relaxes a query whose words are all known
 * (that would show unrelated products for an honest "we don't have that").
 */
export function searchDiscoveryProducts(
  products: ProductPublicDto[],
  filters: { search: string; category: DiscoveryCategorySlug | ''; subcategory: DiscoverySubcategorySlug | '' },
  taxonomy: Taxonomy = DEFAULT_TAXONOMY,
): DiscoverySearchResult {
  if (!filters.search) return { products: filterDiscoveryProducts(products, filters, taxonomy), searchedFor: '', corrections: [], dropped: [] };
  const expanded = expandDiscoveryQuery(products, filters.search, taxonomy);
  const strict = filterDiscoveryProducts(products, filters, taxonomy, expanded.groups);
  const relaxed = strict.length === 0 ? relaxSearchQuery(expanded) : null;
  if (relaxed) {
    const wider = filterDiscoveryProducts(products, filters, taxonomy, relaxed.groups);
    if (wider.length > 0) return { products: wider, searchedFor: relaxed.display, corrections: expanded.corrections, dropped: expanded.unknown };
  }
  return { products: strict, searchedFor: expanded.display, corrections: expanded.corrections, dropped: [] };
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

/**
 * Gap analysis #11 (2026-10-20): /compare existed but nothing linked to it. The product page offers "Compare with
 * similar": this product and up to two others from the SAME subcategory (a battery is never compared with a
 * charger), the nearest in price first, then by name so the choice is stable. Fewer than one peer: no link. Phone
 * batteries are never offered: each fits one phone, so the battery finder is the comparison that matters.
 */
export function pickComparisonPeers(
  product: ProductPublicDto,
  candidates: ProductPublicDto[],
  taxonomy: Taxonomy = DEFAULT_TAXONOMY,
  limit = 2,
): ProductPublicDto[] {
  const sub = getProductSubcategory(product, taxonomy);
  // A replacement battery is chosen by the phone it fits (the battery finder), never side by side with another phone's.
  if (!sub || /batter/i.test(sub)) return [];
  const price = (p: ProductPublicDto) => (typeof p.retailPriceUgx === 'number' && p.retailPriceUgx > 0 ? p.retailPriceUgx : null);
  const own = price(product);
  return dedupeProductsById(candidates)
    .filter((p) => p.id !== product.id && isListableProduct(p) && price(p) !== null && getProductSubcategory(p, taxonomy) === sub)
    .sort((a, b) => (own === null ? 0 : Math.abs(price(a)! - own) - Math.abs(price(b)! - own)) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ── Filters (gap analysis #5, 2026-10-20) ─────────────────────────────────────
// Contextual, like the big shops: a filter appears only when it splits the products on screen. Built from
// VERIFIED specifications only (attributeValues with isVerified) and from price; never from guessed data. Brand is
// not a filter (every product is GoldPlus) and neither is stock while everything listed is in stock.

/** The specifications worth filtering by: short, comparable values. Long prose fields (Protection, Features) are not. */
export const FILTER_ATTRIBUTES = ['Capacity', 'Output power', 'Connector', 'Length', 'Fast charging', 'Colour', 'Type'] as const;

export const PRICE_BANDS = [
  { key: 'under-20k', label: 'Under UGX 20,000', min: 0, max: 19_999 },
  { key: '20k-50k', label: 'UGX 20,000 – 50,000', min: 20_000, max: 50_000 },
  { key: '50k-100k', label: 'UGX 50,001 – 100,000', min: 50_001, max: 100_000 },
  { key: 'over-100k', label: 'Over UGX 100,000', min: 100_001, max: Number.MAX_SAFE_INTEGER },
] as const;

export interface ShopFacetSelection {
  price: string[];
  /** Attribute name -> chosen values (any of them; different attributes must all hold). */
  specs: Record<string, string[]>;
}
export interface ShopFacetOption { value: string; label: string; count: number; selected: boolean }
export interface ShopFacet { key: string; label: string; options: ShopFacetOption[] }

export const EMPTY_FACETS: ShopFacetSelection = { price: [], specs: {} };

function specValues(product: ProductPublicDto, attribute: string): string[] {
  return (product.attributeValues ?? [])
    .filter((a) => a.isVerified && a.name === attribute && String(a.value).trim())
    .map((a) => `${String(a.value).trim()}${a.unit ? ` ${a.unit}` : ''}`.slice(0, 60));
}

function priceBandOf(product: ProductPublicDto): string | null {
  const p = product.retailPriceUgx;
  if (typeof p !== 'number' || p <= 0) return null;
  return PRICE_BANDS.find((b) => p >= b.min && p <= b.max)?.key ?? null;
}

function matchesFacets(product: ProductPublicDto, sel: ShopFacetSelection, skip?: string): boolean {
  if (skip !== 'price' && sel.price.length && !sel.price.includes(priceBandOf(product) ?? '')) return false;
  for (const [attr, values] of Object.entries(sel.specs)) {
    if (attr === skip || values.length === 0) continue;
    const own = specValues(product, attr);
    if (!values.some((v) => own.includes(v))) return false;
  }
  return true;
}

export function applyShopFacets(products: ProductPublicDto[], sel: ShopFacetSelection): ProductPublicDto[] {
  return products.filter((p) => matchesFacets(p, sel));
}

/** "20000 mAh" before "10000 mAh"? No: numbers ascending, then words. */
function compareValues(a: string, b: string): number {
  const na = Number.parseFloat(a); const nb = Number.parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/**
 * The filters for these products. Each option's count is what choosing it would show, given every OTHER filter
 * already chosen (so a count never promises products that the other choices hide).
 */
export function buildShopFacets(products: ProductPublicDto[], sel: ShopFacetSelection): ShopFacet[] {
  const facets: ShopFacet[] = [];
  const priced = products.filter((p) => matchesFacets(p, sel, 'price'));
  const bandCounts = new Map<string, number>();
  for (const p of priced) { const b = priceBandOf(p); if (b) bandCounts.set(b, (bandCounts.get(b) ?? 0) + 1); }
  if (bandCounts.size >= 2 || sel.price.length) {
    facets.push({
      key: 'price',
      label: 'Price',
      options: PRICE_BANDS.filter((b) => bandCounts.has(b.key) || sel.price.includes(b.key))
        .map((b) => ({ value: b.key, label: b.label, count: bandCounts.get(b.key) ?? 0, selected: sel.price.includes(b.key) })),
    });
  }
  for (const attr of FILTER_ATTRIBUTES) {
    const base = products.filter((p) => matchesFacets(p, sel, attr));
    const counts = new Map<string, number>();
    let covered = 0;
    for (const p of base) {
      const vals = [...new Set(specValues(p, attr))];
      if (vals.length) covered += 1;
      for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const chosen = sel.specs[attr] ?? [];
    // Worth showing: at least two values, on at least a third of what is on screen, and not a wall of options.
    // (5 of 11 power banks have a checked capacity; hiding that filter would hide the one shoppers want most.)
    const useful = counts.size >= 2 && covered * 3 >= base.length && counts.size <= 10;
    if (!useful && chosen.length === 0) continue;
    facets.push({
      key: attr,
      label: attr,
      options: [...new Set([...counts.keys(), ...chosen])].sort(compareValues)
        .map((v) => ({ value: v, label: v, count: counts.get(v) ?? 0, selected: chosen.includes(v) })),
    });
  }
  return facets;
}

/** URL form: ?price=under-20k&price=20k-50k&spec=Capacity:20000%20mAh. Unknown keys and junk are dropped. */
export function parseShopFacets(params: URLSearchParams): ShopFacetSelection {
  const bands = new Set<string>(PRICE_BANDS.map((b) => b.key));
  const price = params.getAll('price').filter((v) => bands.has(v)).slice(0, PRICE_BANDS.length);
  const specs: Record<string, string[]> = {};
  for (const raw of params.getAll('spec').slice(0, 20)) {
    const i = raw.indexOf(':');
    if (i < 1) continue;
    const attr = raw.slice(0, i);
    const value = raw.slice(i + 1).trim().slice(0, 60);
    if (!(FILTER_ATTRIBUTES as readonly string[]).includes(attr) || !value) continue;
    (specs[attr] ??= []).includes(value) || specs[attr].push(value);
  }
  return { price, specs };
}

export function writeShopFacets(params: URLSearchParams, sel: ShopFacetSelection): void {
  for (const p of sel.price) params.append('price', p);
  for (const [attr, values] of Object.entries(sel.specs)) for (const v of values) params.append('spec', `${attr}:${v}`);
}

/** The selection with one option switched on or off. */
export function toggleShopFacet(sel: ShopFacetSelection, key: string, value: string): ShopFacetSelection {
  if (key === 'price') {
    return { ...sel, price: sel.price.includes(value) ? sel.price.filter((v) => v !== value) : [...sel.price, value] };
  }
  const cur = sel.specs[key] ?? [];
  const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
  const specs = { ...sel.specs, [key]: next };
  if (next.length === 0) delete specs[key];
  return { ...sel, specs };
}

export function hasShopFacets(sel: ShopFacetSelection): boolean {
  return sel.price.length > 0 || Object.values(sel.specs).some((v) => v.length > 0);
}
