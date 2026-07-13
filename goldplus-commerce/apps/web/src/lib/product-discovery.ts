import type { ProductPublicDto } from '@goldplus/shared';

export const DISCOVERY_TAXONOMY = [
  { slug: 'power-devices', name: 'Power Devices', subcategories: [
    { slug: 'chargers', name: 'Chargers' },
    { slug: 'power-banks', name: 'Power Banks' },
  ] },
  { slug: 'sound-devices', name: 'Sound Devices', subcategories: [
    { slug: 'earbuds', name: 'Earbuds' },
    { slug: 'speakers', name: 'Speakers' },
  ] },
  { slug: 'storage-devices', name: 'Storage Devices', subcategories: [
    { slug: 'flash-drives', name: 'Flash Drives' },
    { slug: 'memory-cards', name: 'Memory Cards' },
  ] },
  { slug: 'car-accessories', name: 'Car Accessories', subcategories: [
    { slug: 'mounts', name: 'Mounts' },
    { slug: 'car-chargers', name: 'Car Chargers' },
  ] },
] as const;

export type DiscoveryCategorySlug = typeof DISCOVERY_TAXONOMY[number]['slug'];
export type DiscoverySubcategorySlug = typeof DISCOVERY_TAXONOMY[number]['subcategories'][number]['slug'];
export type DiscoverySort = 'default' | 'price-low-high' | 'price-high-low' | 'name-a-z';

const LEGACY_CATEGORY_ALIASES: Record<string, DiscoveryCategorySlug> = {
  power: 'power-devices',
  sound: 'sound-devices',
  storage: 'storage-devices',
  car: 'car-accessories',
};

const VALID_SORTS = new Set<DiscoverySort>(['default', 'price-low-high', 'price-high-low', 'name-a-z']);

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

export function normalizeCategoryParam(value: string | null): DiscoveryCategorySlug | '' {
  const candidate = (value ?? '').trim().toLowerCase();
  const canonical = LEGACY_CATEGORY_ALIASES[candidate] ?? candidate;
  return DISCOVERY_TAXONOMY.some((item) => item.slug === canonical) ? canonical as DiscoveryCategorySlug : '';
}

export function normalizeSubcategoryParam(
  value: string | null,
  category: DiscoveryCategorySlug | '',
): DiscoverySubcategorySlug | '' {
  if (!category) return '';
  const candidate = (value ?? '').trim().toLowerCase();
  const categoryEntry = DISCOVERY_TAXONOMY.find((item) => item.slug === category);
  return categoryEntry?.subcategories.some((item) => item.slug === candidate)
    ? candidate as DiscoverySubcategorySlug
    : '';
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

export function categoryNameForSlug(slug: DiscoveryCategorySlug | ''): string {
  return DISCOVERY_TAXONOMY.find((item) => item.slug === slug)?.name ?? '';
}

export function subcategoryNameForSlug(slug: DiscoverySubcategorySlug | ''): string {
  for (const category of DISCOVERY_TAXONOMY) {
    const match = category.subcategories.find((item) => item.slug === slug);
    if (match) return match.name;
  }
  return '';
}

export function getProductSubcategory(product: ProductPublicDto): DiscoverySubcategorySlug | '' {
  const searchable = `${product.name} ${product.categoryName}`.toLowerCase();
  if (/\bpower\s*bank\b/.test(searchable)) return 'power-banks';
  if (/\bcar\s+charger\b/.test(searchable)) return 'car-chargers';
  if (/\bcharger|adapter|charging\s+brick\b/.test(searchable)) return 'chargers';
  if (/\bearbud|earphone|headphone\b/.test(searchable)) return 'earbuds';
  if (/\bspeaker\b/.test(searchable)) return 'speakers';
  if (/\bflash\s+drive|usb\s+drive\b/.test(searchable)) return 'flash-drives';
  if (/\bmemory\s+card|micro\s*sd|sd\s+card\b/.test(searchable)) return 'memory-cards';
  if (/\bmount\b/.test(searchable)) return 'mounts';
  return '';
}

export function dedupeProductsById(products: ProductPublicDto[]): ProductPublicDto[] {
  const seen = new Set<string>();
  return products.filter((product) => {
    if (!product?.id || seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
}

export function isApprovedDiscoveryProduct(product: ProductPublicDto): boolean {
  return DISCOVERY_TAXONOMY.some((category) => category.name === product.categoryName);
}

export function matchesDiscoveryQuery(product: ProductPublicDto, query: string): boolean {
  if (!query) return true;
  const subcategory = subcategoryNameForSlug(getProductSubcategory(product));
  return [product.name, product.categoryName, subcategory, product.sku, product.modelNumber]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.toLocaleLowerCase('en').includes(query.toLocaleLowerCase('en')));
}

export function filterDiscoveryProducts(
  products: ProductPublicDto[],
  filters: { search: string; category: DiscoveryCategorySlug | ''; subcategory: DiscoverySubcategorySlug | '' },
): ProductPublicDto[] {
  const categoryName = categoryNameForSlug(filters.category);
  return dedupeProductsById(products)
    .filter(isApprovedDiscoveryProduct)
    .filter((product) => !categoryName || product.categoryName === categoryName)
    .filter((product) => !filters.subcategory || getProductSubcategory(product) === filters.subcategory)
    .filter((product) => matchesDiscoveryQuery(product, filters.search));
}

export function sortDiscoveryProducts(products: ProductPublicDto[], sort: DiscoverySort): ProductPublicDto[] {
  const list = [...products];
  const safePrice = (product: ProductPublicDto) =>
    typeof product.retailPriceUgx === 'number' && Number.isFinite(product.retailPriceUgx) && product.retailPriceUgx > 0
      ? product.retailPriceUgx
      : Number.POSITIVE_INFINITY;
  if (sort === 'price-low-high') return list.sort((a, b) => safePrice(a) - safePrice(b) || a.name.localeCompare(b.name));
  if (sort === 'price-high-low') return list.sort((a, b) => safePrice(b) - safePrice(a) || a.name.localeCompare(b.name));
  if (sort === 'name-a-z') return list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}
