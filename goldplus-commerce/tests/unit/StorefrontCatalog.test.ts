import { describe, it, expect } from 'vitest';
import { 
  normalizeProductCategory, 
  getQueryIntent, 
  matchesQuery, 
  sortProducts,
  LOCAL_SEED_PRODUCTS,
  getCleanCatalog,
} from '../../apps/web/src/lib/catalog/catalog';
import type { ProductPublicDto } from '@goldplus/shared';

const MOCK_BASE_PRODUCT: ProductPublicDto = {
  id: 'test-id',
  slug: 'test-product',
  name: 'Test Product',
  categoryName: 'Other',
  sku: 'TST-001',
  modelNumber: 'GP-TST',
  retailPriceUgx: 50000,
  availability: { kind: 'in_stock', quantity: 10 },
  hasImage: true,
  primaryImageUrl: 'https://example.com/test.jpg',
  verifiedSpecs: {},
  hasMissingSpecs: false,
  images: [],
  attributeValues: []
};

describe('Storefront Catalog Normalization & Inference', () => {
  it('keeps a populated API catalogue authoritative without injecting local seeds', () => {
    const apiProduct = { ...MOCK_BASE_PRODUCT, id: 'api-product', slug: 'api-product' };

    expect(getCleanCatalog([apiProduct]).map((product) => product.id)).toEqual(['api-product']);
  });

  it('does not let a legacy slug denylist override live API authority', () => {
    const liveProduct = { ...MOCK_BASE_PRODUCT, id: 'live-product', slug: 'generic-fast-charger' };

    expect(getCleanCatalog([liveProduct]).map((product) => product.id)).toEqual(['live-product']);
  });

  it('uses local seeds only when the API catalogue is unavailable or empty', () => {
    expect(getCleanCatalog([]).map((product) => product.id)).toEqual(
      LOCAL_SEED_PRODUCTS.map((product) => product.id),
    );
  });

  it('should preserve Power Devices and Sound Devices categories', () => {
    const powerProd = { ...MOCK_BASE_PRODUCT, categoryName: 'Power Devices' };
    const soundProd = { ...MOCK_BASE_PRODUCT, categoryName: 'Sound Devices' };

    expect(normalizeProductCategory(powerProd).categoryName).toBe('Power Devices');
    expect(normalizeProductCategory(soundProd).categoryName).toBe('Sound Devices');
  });

  it('should infer Storage Devices category from storage terms in general/other products', () => {
    const flashProd = { ...MOCK_BASE_PRODUCT, name: 'Super Flash Drive 64GB', categoryName: 'Other' };
    const usbProd = { ...MOCK_BASE_PRODUCT, name: 'Rugged USB Drive', categoryName: 'Other' };
    const sdProd = { ...MOCK_BASE_PRODUCT, name: 'MicroSD Card 128G', categoryName: 'Other' };

    expect(normalizeProductCategory(flashProd).categoryName).toBe('Storage Devices');
    expect(normalizeProductCategory(usbProd).categoryName).toBe('Storage Devices');
    expect(normalizeProductCategory(sdProd).categoryName).toBe('Storage Devices');
  });

  it('should infer Car Accessories category from car/mount terms in general/other products', () => {
    const mountProd = { ...MOCK_BASE_PRODUCT, name: 'Dashboard Phone Mount', categoryName: 'Other' };
    const carProd = { ...MOCK_BASE_PRODUCT, name: 'Heavy Duty Car Charger', categoryName: 'Other' };

    expect(normalizeProductCategory(mountProd).categoryName).toBe('Car Accessories');
    expect(normalizeProductCategory(carProd).categoryName).toBe('Car Accessories');
  });

  it('should infer PC Accessories category from mice/audio card terms', () => {
    const mouseProd = { ...MOCK_BASE_PRODUCT, name: 'GP Wireless Mouse', categoryName: 'Other' };
    const cardProd = { ...MOCK_BASE_PRODUCT, name: 'External USB Sound Card', categoryName: 'Other' };

    expect(normalizeProductCategory(mouseProd).categoryName).toBe('PC Accessories');
    expect(normalizeProductCategory(cardProd).categoryName).toBe('PC Accessories');
  });
});

describe('Storefront Catalog Search Query Intent Inference', () => {
  it('should resolve direct query keywords to primary categories', () => {
    expect(getQueryIntent('charger')).toBe('Power Devices');
    expect(getQueryIntent('charging cable')).toBe('Power Devices');
    expect(getQueryIntent('earbuds')).toBe('Sound Devices');
    expect(getQueryIntent('headphones')).toBe('Sound Devices');
    expect(getQueryIntent('flash')).toBe('Storage Devices');
    expect(getQueryIntent('usb drive')).toBe('Storage Devices');
    expect(getQueryIntent('mount')).toBe('Car Accessories');
    expect(getQueryIntent('dashboard mount')).toBe('Car Accessories');
    expect(getQueryIntent('mouse')).toBe('PC Accessories');
    expect(getQueryIntent('sound card')).toBe('PC Accessories');
  });

  it('should resolve word boundary matches', () => {
    expect(getQueryIntent('fast charger')).toBe('Power Devices');
    expect(getQueryIntent('wireless earbuds')).toBe('Sound Devices');
    expect(getQueryIntent('micro sd')).toBe('Storage Devices');
  });

  it('should return null for unknown keywords', () => {
    expect(getQueryIntent('keyboard')).toBeNull();
    expect(getQueryIntent('laptop')).toBeNull();
  });
});

describe('Storefront Catalog Search Query Matcher', () => {
  it('should match search query directly in title, SKU or model', () => {
    const product = { ...MOCK_BASE_PRODUCT, name: 'Reinforced Cable', sku: 'PWR-CBL-001', modelNumber: 'GP-UC' };

    expect(matchesQuery(product, 'reinforced')).toBe(true);
    expect(matchesQuery(product, 'PWR-CBL')).toBe(true);
    expect(matchesQuery(product, 'GP-UC')).toBe(true);
    expect(matchesQuery(product, 'earbud')).toBe(false);
  });

  it('should match search query by inferred category intent to prevent false empty states', () => {
    const product = { ...MOCK_BASE_PRODUCT, name: 'Reinforced Cable', categoryName: 'Power Devices' };

    // "charger" mapped intent is "Power Devices", which matches the product's categoryName!
    expect(matchesQuery(product, 'charger')).toBe(true);
    expect(matchesQuery(product, 'powerbank')).toBe(true);
    expect(matchesQuery(product, 'earbuds')).toBe(false);
  });
});

describe('Storefront Catalog Sorting', () => {
  const products: ProductPublicDto[] = [
    { ...MOCK_BASE_PRODUCT, id: 'a', name: 'Z Product', retailPriceUgx: 100000 },
    { ...MOCK_BASE_PRODUCT, id: 'b', name: 'A Product', retailPriceUgx: 20000 },
    { ...MOCK_BASE_PRODUCT, id: 'c', name: 'M Product', retailPriceUgx: 50000 }
  ];

  it('should sort products stably by price ascending', () => {
    const sorted = sortProducts(products, 'price_low_high');
    expect(sorted[0].id).toBe('b'); // 20000
    expect(sorted[1].id).toBe('c'); // 50000
    expect(sorted[2].id).toBe('a'); // 100000
  });

  it('should sort products stably by price descending', () => {
    const sorted = sortProducts(products, 'price_high_low');
    expect(sorted[0].id).toBe('a'); // 100000
    expect(sorted[1].id).toBe('c'); // 50000
    expect(sorted[2].id).toBe('b'); // 20000
  });

  it('should sort products stably by name A-Z', () => {
    const sorted = sortProducts(products, 'name_az');
    expect(sorted[0].name).toBe('A Product');
    expect(sorted[1].name).toBe('M Product');
    expect(sorted[2].name).toBe('Z Product');
  });

  it('should fall back to stable ID-based sorting as default', () => {
    const sorted = sortProducts(products, 'featured');
    expect(sorted[0].id).toBe('a');
    expect(sorted[1].id).toBe('b');
    expect(sorted[2].id).toBe('c');
  });
});
