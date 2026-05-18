import { describe, it, expect } from 'vitest';
import { getCategoryAwareProducts } from '../../apps/web/src/lib/homepage-merchandising';
import { LOCAL_SEED_PRODUCTS } from '../../apps/web/src/lib/catalog/catalog';
import type { ProductPublicDto } from '@goldplus/shared';

describe('GoldPlus UI Pass H1E — Homepage Merchandising', () => {
  const mockProducts: ProductPublicDto[] = [
    {
      id: 'p-1',
      slug: 'plug',
      name: 'Power Plug',
      categoryName: 'Power Devices',
      retailPriceUgx: 20000,
      availability: { kind: 'in_stock', quantity: 10 },
      hasImage: true,
      images: []
    },
    {
      id: 'p-2',
      slug: 'buds',
      name: 'Noise Earbuds',
      categoryName: 'Sound Devices',
      retailPriceUgx: 50000,
      availability: { kind: 'in_stock', quantity: 20 },
      hasImage: true,
      images: []
    },
    {
      id: 'p-3',
      slug: 'sd-card-64',
      name: 'Flash SD Card 64GB',
      categoryName: 'Other', // Will be normalized to Storage Devices
      retailPriceUgx: 30000,
      availability: { kind: 'in_stock', quantity: 15 },
      hasImage: true,
      images: []
    }
  ];

  it('should filter category-aware products correctly and normalize categories', () => {
    // sound slug mapped to Sound Devices
    const soundProducts = getCategoryAwareProducts(mockProducts, 'sound');
    expect(soundProducts.length).toBe(1);
    expect(soundProducts[0].id).toBe('p-2');

    // storage slug mapped to Storage Devices (after normalization of 'Other' category containing word 'SD')
    const storageProducts = getCategoryAwareProducts(mockProducts, 'storage');
    expect(storageProducts.length).toBe(1);
    expect(storageProducts[0].id).toBe('p-3');
    expect(storageProducts[0].categoryName).toBe('Storage Devices');
  });

  it('should respect excludeProductIds and deduplicate correctly', () => {
    const powerProducts = getCategoryAwareProducts(mockProducts, 'power', ['p-1']);
    expect(powerProducts.length).toBe(0);
  });

  it('should return empty array if category slug is invalid', () => {
    const invalidProducts = getCategoryAwareProducts(mockProducts, 'invalid-slug');
    expect(invalidProducts.length).toBe(0);
  });
});
