import { expect, test, describe } from 'vitest';
import { ProductEntity } from '../../apps/api/src/domain/products/ProductEntity';

describe('ProductEntity Domain Rules', () => {
  test('Cannot publish a product without a price', () => {
    const product = new ProductEntity(
      'id1', 'SKU1', 'MOD1', 'Test', 'cat1', 'approved', false, false, true, 10
    );
    expect(product.canBePublished()).toBe(false);
  });

  test('Cannot publish a product if model number is missing (Governance rule)', () => {
    const product = new ProductEntity(
      'id2', 'SKU2', 'Missing. Requires admin review.', 'Test', 'cat1', 'approved', false, true, true, 10
    );
    expect(product.canBePublished()).toBe(false);
  });

  test('Can publish a valid product', () => {
    const product = new ProductEntity(
      'id3', 'SKU3', 'REAL-MOD-01', 'Test', 'cat1', 'approved', false, true, true, 10
    );
    expect(product.canBePublished()).toBe(true);
  });
});
