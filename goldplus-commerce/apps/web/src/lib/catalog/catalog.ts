import type { ProductPublicDto } from '@goldplus/shared';

export function normalizeProductCategory(product: ProductPublicDto): ProductPublicDto {
  const nameLower = product.name.toLowerCase();
  const rawCat = product.categoryName;

  let inferredCategory = rawCat;

  if (rawCat === 'Power Devices') {
    inferredCategory = 'Power Devices';
  } else if (rawCat === 'Sound Devices') {
    inferredCategory = 'Sound Devices';
  } else {
    // Check keyword patterns for category inference on general/other categories
    const isStorage = /\b(flash|drive|usb|sd|storage|microsd)\b/i.test(product.name);
    const isCar = /\b(car|mount|vehicle)\b/i.test(product.name);
    const isPc = /\b(mouse|mice|sound card|audio card)\b/i.test(product.name);

    if (isPc) {
      inferredCategory = 'PC Accessories';
    } else if (isCar) {
      inferredCategory = 'Car Accessories';
    } else if (isStorage) {
      inferredCategory = 'Storage Devices';
    }
  }

  return {
    ...product,
    categoryName: inferredCategory
  };
}

/**
 * Approved storefront short category label translation maps
 */
export const CATEGORY_SLUG_TO_NAME: Record<string, string> = {
  'power': 'Power Devices',
  'sound': 'Sound Devices',
  'storage': 'Storage Devices',
  'car': 'Car Accessories',
  'pc': 'PC Accessories'
};

export const CATEGORY_NAME_TO_SLUG: Record<string, string> = {
  'Power Devices': 'power',
  'Sound Devices': 'sound',
  'Storage Devices': 'storage',
  'Car Accessories': 'car',
  'PC Accessories': 'pc'
};

/**
 * 3. Query Intent Inference Engine mapping query aliases to approved categories
 */
const QUERY_TO_CATEGORY_MAP: Record<string, string> = {
  // Power Devices
  'charger': 'Power Devices',
  'chargers': 'Power Devices',
  'adapter': 'Power Devices',
  'wall adapter': 'Power Devices',
  'charging brick': 'Power Devices',
  'charging cable': 'Power Devices',
  'cable': 'Power Devices',
  'power bank': 'Power Devices',
  'powerbank': 'Power Devices',
  'fast charger': 'Power Devices',

  // Sound Devices
  'earbuds': 'Sound Devices',
  'earphones': 'Sound Devices',
  'headphones': 'Sound Devices',
  'speaker': 'Sound Devices',
  'speakers': 'Sound Devices',
  'bluetooth speaker': 'Sound Devices',
  'wireless earbuds': 'Sound Devices',
  'audio': 'Sound Devices',

  // Storage Devices
  'flash': 'Storage Devices',
  'flash drive': 'Storage Devices',
  'usb': 'Storage Devices',
  'usb drive': 'Storage Devices',
  'sd card': 'Storage Devices',
  'micro sd': 'Storage Devices',
  'microsd': 'Storage Devices',
  'memory card': 'Storage Devices',
  'external drive': 'Storage Devices',
  'external ssd': 'Storage Devices',
  'storage': 'Storage Devices',

  // Car Accessories
  'car': 'Car Accessories',
  'car charger': 'Car Accessories',
  'vehicle charger': 'Car Accessories',
  'mount': 'Car Accessories',
  'phone mount': 'Car Accessories',
  'dashboard mount': 'Car Accessories',
  'dash mount': 'Car Accessories',
  'vent mount': 'Car Accessories',
  'windshield mount': 'Car Accessories',

  // PC Accessories
  'mouse': 'PC Accessories',
  'mice': 'PC Accessories',
  'computer mouse': 'PC Accessories',
  'wireless mouse': 'PC Accessories',
  'sound card': 'PC Accessories',
  'sound cards': 'PC Accessories',
  'audio card': 'PC Accessories',
  'usb sound card': 'PC Accessories',
};

export function getQueryIntent(query: string): string | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  // Direct exact match first
  if (QUERY_TO_CATEGORY_MAP[needle]) {
    return QUERY_TO_CATEGORY_MAP[needle];
  }

  // Word matching boundary check
  for (const [key, category] of Object.entries(QUERY_TO_CATEGORY_MAP)) {
    if (needle.includes(key) || key.includes(needle)) {
      return category;
    }
  }

  return null;
}

/**
 * 4. Query Search Matcher combining direct search with query intent matches
 * to prevent false empty states on header categories.
 */
export function matchesQuery(product: ProductPublicDto, query: string): boolean {
  if (!query) return true;
  const needle = query.trim().toLowerCase();

  // A. Direct field matching (name, SKU, model number, specs)
  const nameMatch = product.name.toLowerCase().includes(needle);
  const skuMatch = product.sku?.toLowerCase().includes(needle) ?? false;
  const modelMatch = product.modelNumber?.toLowerCase().includes(needle) ?? false;
  
  if (nameMatch || skuMatch || modelMatch) {
    return true;
  }

  // B. Search Query Intent mapping (charger -> Power Devices, earbuds -> Sound Devices, etc.)
  const intentCategory = getQueryIntent(query);
  if (intentCategory && product.categoryName === intentCategory) {
    return true;
  }

  return false;
}

/**
 * 5. Stable sorting implementation for storefront products.
 */
export function sortProducts(products: ProductPublicDto[], sortKey: string): ProductPublicDto[] {
  const list = [...products];

  switch (sortKey) {
    case 'price_low_high':
      return list.sort((a, b) => {
        const pA = a.retailPriceUgx ?? 0;
        const pB = b.retailPriceUgx ?? 0;
        return pA - pB || a.name.localeCompare(b.name);
      });
    case 'price_high_low':
      return list.sort((a, b) => {
        const pA = a.retailPriceUgx ?? 0;
        const pB = b.retailPriceUgx ?? 0;
        return pB - pA || a.name.localeCompare(b.name);
      });
    case 'name_az':
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case 'featured':
    default:
      // Keep static index/id sorting as stable default
      return list.sort((a, b) => a.id.localeCompare(b.id));
  }
}

/**
 * 6. Keeps a populated API response authoritative.
 * The local catalogue is an availability fallback only; it must never be merged into live data.
 */
/**
 * Normalises the LIVE catalogue for display. R1 (2026-08-06) retirements,
 * both named because both invented facts at the render boundary:
 *
 * - LOCAL_SEED_PRODUCTS: a hardcoded catalogue of ~16 fabricated products
 *   (invented UUIDs, invented prices, invented "in stock" quantities) that was
 *   served whenever the API returned nothing — including a LIVE fabricated PDP
 *   with an Add-to-cart button for a product the database has never contained.
 *   An empty catalogue now renders as an honest empty state. Real products
 *   enter through the PIM import, never through source code.
 * - STALE_SLUGS: a blocklist that named ALL EIGHT live product slugs, so every
 *   recommendation surface rejected the entire real catalogue and rendered
 *   empty since 2026-07-21 while /shop happily sold the same products.
 */
export function getCleanCatalog(apiProducts: ProductPublicDto[]): ProductPublicDto[] {
  return (apiProducts || []).filter(p => p && p.slug).map(p => normalizeProductCategory(p));
}
