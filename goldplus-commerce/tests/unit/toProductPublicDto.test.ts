import { describe, it, expect } from 'vitest';
import { toProductPublicDto } from '../../apps/api/src/application/mappers/toProductPublicDto';
import { ProductEntity, StockStatus } from '../../apps/api/src/domain/products/ProductEntity';
import { ProductWithPrice } from '../../apps/api/src/application/ports/IProductRepository';

function makeSource(overrides: Partial<{
  modelNumber: string;
  sku: string;
  hasRetailPrice: boolean;
  retailPrice: number | null;
  categoryName: string | null;
  isPreOrder: boolean;
  stock: number;
  specs: Record<string, string | number>;
  hasImage: boolean;
}> = {}): ProductWithPrice {
  const entity = new ProductEntity(
    'id-1',
    overrides.sku ?? 'GP-CH-01',
    overrides.modelNumber ?? 'GP-CH-01',
    'Test charger',
    'test-charger',
    overrides.categoryName ?? 'Power devices',
    undefined,
    'Short description',
    'Long description',
    0, // priceUgx on entity
    undefined,
    'in_stock', // stockStatus
    undefined,
    [], // features
    '1 Year', // warrantyPeriod
    true, // verificationEligible
    true, // active
    'approved',
    overrides.isPreOrder ?? false,
    overrides.hasRetailPrice ?? true,
    overrides.hasImage ?? true,
    overrides.stock ?? 10,
    overrides.specs ?? { Wattage: '20W' },
  );
  return {
    entity,
    retailPriceUgx: overrides.retailPrice === undefined ? 50000 : overrides.retailPrice,
    categoryName: overrides.categoryName === undefined ? 'Power devices' : overrides.categoryName,
  };
}

describe('toProductPublicDto', () => {
  it('publishes the happy-path product', () => {
    const dto = toProductPublicDto(makeSource());
    expect(dto.name).toBe('Test charger');
    expect(dto.sku).toBe('GP-CH-01');
    expect(dto.modelNumber).toBe('GP-CH-01');
    expect(dto.categoryName).toBe('Power devices');
    expect(dto.retailPriceUgx).toBe(50000);
    expect(dto.availability).toEqual({ kind: 'in_stock', quantity: 10 });
    expect(dto.hasMissingSpecs).toBe(false);
    expect(dto.verifiedSpecs).toEqual({ Wattage: '20W' });
  });

  it('treats sentinel "Missing. Requires admin review." strings as null', () => {
    const dto = toProductPublicDto(makeSource({
      sku: 'Missing. Requires admin review.',
      modelNumber: 'Missing. Requires admin review.',
    }));
    expect(dto.sku).toBeNull();
    expect(dto.modelNumber).toBeNull();
    expect(dto.hasMissingSpecs).toBe(true);
  });

  it('drops missing-sentinel specs from verifiedSpecs', () => {
    const dto = toProductPublicDto(makeSource({
      specs: {
        Wattage: '20W',
        Warranty: 'Missing. Requires admin review.',
        Cable: 'Unspecified in source.',
        Compatibility: 'USB-C',
      },
    }));
    expect(dto.verifiedSpecs).toEqual({ Wattage: '20W', Compatibility: 'USB-C' });
  });

  it('returns null retailPriceUgx when hasRetailPrice is false', () => {
    const dto = toProductPublicDto(makeSource({ hasRetailPrice: false, retailPrice: 99999 }));
    expect(dto.retailPriceUgx).toBeNull();
  });

  it('returns null retailPriceUgx when join produced no price row', () => {
    const dto = toProductPublicDto(makeSource({ hasRetailPrice: true, retailPrice: null }));
    expect(dto.retailPriceUgx).toBeNull();
  });

  it('reports availability "out_of_stock" when stock is zero', () => {
    const dto = toProductPublicDto(makeSource({ stock: 0 }));
    expect(dto.availability).toEqual({ kind: 'out_of_stock' });
  });

  it('reports availability "pre_order" when pre-order is enabled, regardless of stock', () => {
    const dto = toProductPublicDto(makeSource({ isPreOrder: true, stock: 0 }));
    expect(dto.availability).toEqual({ kind: 'pre_order' });
  });

  it('reports availability "unknown" when stockTracked=false', () => {
    const dto = toProductPublicDto(makeSource({ stock: 5 }), { stockTracked: false });
    expect(dto.availability).toEqual({ kind: 'unknown' });
  });

  it('falls back to "Uncategorised" when the category join is empty', () => {
    const dto = toProductPublicDto(makeSource({ categoryName: null }));
    expect(dto.categoryName).toBe('Uncategorised');
  });

  it('rejects zero / negative / non-finite prices', () => {
    expect(toProductPublicDto(makeSource({ retailPrice: 0 })).retailPriceUgx).toBeNull();
    expect(toProductPublicDto(makeSource({ retailPrice: -10 })).retailPriceUgx).toBeNull();
    expect(toProductPublicDto(makeSource({ retailPrice: Number.NaN })).retailPriceUgx).toBeNull();
  });

  it('does not expose internal fields', () => {
    const dto = toProductPublicDto(makeSource()) as Record<string, unknown>;
    expect(dto).not.toHaveProperty('categoryId');
    expect(dto).not.toHaveProperty('approvalStatus');
    expect(dto).not.toHaveProperty('isFeedEligible');
    expect(dto).not.toHaveProperty('hasRetailPrice');
  });
});
