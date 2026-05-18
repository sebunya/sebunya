import type { ProductPublicDto } from '@goldplus/shared';

/**
 * 1. Resilient Fallback Payload matching the 8 authoritative seeded products
 */
export const LOCAL_SEED_PRODUCTS: ProductPublicDto[] = [
  {
    id: '68001def-f81c-46e3-903e-c3b51e34e8b1',
    slug: 'generic-fast-charger',
    name: 'Generic Fast Charger',
    categoryName: 'Power Devices',
    sku: 'PWR-CHG-001',
    modelNumber: 'GP-FC-20W',
    retailPriceUgx: 50000,
    availability: { kind: 'in_stock', quantity: 50 },
    hasImage: true,
    primaryImageUrl: 'https://images.unsplash.com/photo-1600003263720-95b45a4035d5?auto=format&fit=crop&q=80&w=600',
    verifiedSpecs: { wattage: '20W' },
    hasMissingSpecs: false,
    images: [{ url: 'https://images.unsplash.com/photo-1600003263720-95b45a4035d5?auto=format&fit=crop&q=80&w=600', alt: 'Generic Fast Charger Plug' }],
    attributeValues: []
  },
  {
    id: '27b396dd-55c1-4181-9772-aec1bf4a3dcf',
    slug: 'wireless-earbuds',
    name: 'Wireless Earbuds',
    categoryName: 'Sound Devices',
    sku: 'SND-EP-001',
    modelNumber: 'GP-WE-X1',
    retailPriceUgx: 80000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&q=80&w=600',
    verifiedSpecs: {},
    hasMissingSpecs: false,
    images: [{ url: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&q=80&w=600', alt: 'Wireless Earbuds with Charging Case' }],
    attributeValues: []
  },
  {
    id: '9a7f612b-68e9-47d5-b9ea-442bc7690a02',
    slug: 'reinforced-usb-c-cable',
    name: 'Reinforced USB-C Cable',
    categoryName: 'Power Devices',
    sku: 'PWR-CBL-002',
    modelNumber: 'GP-UC-2M',
    retailPriceUgx: 25000,
    availability: { kind: 'in_stock', quantity: 200 },
    hasImage: true,
    primaryImageUrl: 'https://images.unsplash.com/photo-1612815154858-60aa4c59eaa6?auto=format&fit=crop&q=80&w=600',
    verifiedSpecs: { length: '2 Meters' },
    hasMissingSpecs: false,
    images: [{ url: 'https://images.unsplash.com/photo-1612815154858-60aa4c59eaa6?auto=format&fit=crop&q=80&w=600', alt: 'Reinforced USB-C Cable' }],
    attributeValues: []
  },
  {
    id: 'bc1901fa-cfde-49ad-9ccf-818724bbdc6d',
    slug: 'heavy-duty-power-bank',
    name: 'Heavy Duty Power Bank',
    categoryName: 'Power Devices',
    sku: 'PWR-PBK-003',
    modelNumber: 'GP-PB-20K',
    retailPriceUgx: 120000,
    availability: { kind: 'in_stock', quantity: 30 },
    hasImage: true,
    primaryImageUrl: 'https://images.unsplash.com/photo-1609081219090-a6d81d3085bf?auto=format&fit=crop&q=80&w=600',
    verifiedSpecs: { capacity: '20,000 mAh' },
    hasMissingSpecs: false,
    images: [{ url: 'https://images.unsplash.com/photo-1609081219090-a6d81d3085bf?auto=format&fit=crop&q=80&w=600', alt: 'Heavy Duty Power Bank' }],
    attributeValues: []
  },
  {
    id: 'fa7e1a81-c640-4283-bd52-a5d4429ef1e1',
    slug: 'bluetooth-rugged-speaker',
    name: 'Bluetooth Rugged Speaker',
    categoryName: 'Sound Devices',
    sku: 'SND-SPK-004',
    modelNumber: 'GP-BS-05',
    retailPriceUgx: 150000,
    availability: { kind: 'in_stock', quantity: 45 },
    hasImage: true,
    primaryImageUrl: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&q=80&w=600',
    verifiedSpecs: {},
    hasMissingSpecs: false,
    images: [{ url: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&q=80&w=600', alt: 'Bluetooth Rugged Speaker' }],
    attributeValues: []
  },
  {
    id: 'ca8f3d1b-467f-41d1-a461-78a89dc9c201',
    slug: 'car-dashboard-mount',
    name: 'Car Dashboard Mount',
    categoryName: 'Other',
    sku: 'ACC-MT-005',
    modelNumber: 'GP-CM-HD',
    retailPriceUgx: 35000,
    availability: { kind: 'in_stock', quantity: 120 },
    hasImage: true,
    primaryImageUrl: 'https://images.unsplash.com/photo-1586105251261-72a756497a11?auto=format&fit=crop&q=80&w=600',
    verifiedSpecs: {},
    hasMissingSpecs: false,
    images: [{ url: 'https://images.unsplash.com/photo-1586105251261-72a756497a11?auto=format&fit=crop&q=80&w=600', alt: 'Car Dashboard Mount' }],
    attributeValues: []
  },
  {
    id: '7a1e42b9-e278-4b49-af1f-c19bbddcae3a',
    slug: 'usb-3-flash-drive-128gb',
    name: 'USB 3.0 Flash Drive 128GB',
    categoryName: 'Other',
    sku: 'STR-FL-006',
    modelNumber: 'GP-FD-128G',
    retailPriceUgx: 60000,
    availability: { kind: 'in_stock', quantity: 80 },
    hasImage: true,
    primaryImageUrl: 'https://images.unsplash.com/photo-1618424181497-157f25b6ddd5?auto=format&fit=crop&q=80&w=600',
    verifiedSpecs: { storage: '128GB' },
    hasMissingSpecs: false,
    images: [{ url: 'https://images.unsplash.com/photo-1618424181497-157f25b6ddd5?auto=format&fit=crop&q=80&w=600', alt: 'USB 3.0 Flash Drive' }],
    attributeValues: []
  },
  {
    id: '8d1fbc20-a7c8-4122-8b0e-89aa39c654b2',
    slug: 'portable-audio-headset',
    name: 'Portable Audio Headset',
    categoryName: 'Sound Devices',
    sku: 'SND-HD-007',
    modelNumber: 'GP-PH-02',
    retailPriceUgx: 110000,
    availability: { kind: 'in_stock', quantity: 25 },
    hasImage: true,
    primaryImageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&q=80&w=600',
    verifiedSpecs: {},
    hasMissingSpecs: false,
    images: [{ url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&q=80&w=600', alt: 'Portable Audio Headset' }],
    attributeValues: []
  }
];

/**
 * 2. Storefront Normalizer for category mapping and inference.
 * Unifies the internal database categories into the 5 approved storefront categories:
 *  - Power Devices
 *  - Sound Devices
 *  - Storage Devices
 *  - Car Accessories
 *  - PC Accessories
 */
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
