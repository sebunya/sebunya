import { describe, it, expect, vi } from 'vitest';
import { ProductEntity } from '../../apps/api/src/domain/products/ProductEntity';

describe('Product Catalogue Admin & Publishing Validation', () => {
  it('should reject publishing if the product has no retail price', () => {
    const product = new ProductEntity(
      'test-id-1',
      'GP-TEST-001',
      'GP-MOD-1',
      'Test Charger',
      'test-charger',
      'Power Devices',
      undefined,
      'Short description',
      'Long description',
      0, // Zero price
      undefined,
      'in_stock',
      'https://images.unsplash.com/photo-1600003263720-95b45a4035d5',
      [],
      '1 Year',
      true,
      true,
      'approved',
      false,
      false, // hasRetailPrice is false
      true,
      10,
      {}
    );

    expect(product.canBePublished()).toBe(false);
  });

  it('should reject publishing if the model number is the missing sentinel', () => {
    const product = new ProductEntity(
      'test-id-2',
      'GP-TEST-002',
      'Missing. Requires admin review.', // Missing sentinel
      'Test Charger',
      'test-charger',
      'Power Devices',
      undefined,
      'Short description',
      'Long description',
      50000,
      undefined,
      'in_stock',
      'https://images.unsplash.com/photo-1600003263720-95b45a4035d5',
      [],
      '1 Year',
      true,
      true,
      'approved',
      false,
      true, // hasRetailPrice is true
      true,
      10,
      {}
    );

    expect(product.canBePublished()).toBe(false);
  });

  it('should reject publishing if the product is not in pre-order mode and has zero stock', () => {
    const product = new ProductEntity(
      'test-id-3',
      'GP-TEST-003',
      'GP-MOD-3',
      'Test Charger',
      'test-charger',
      'Power Devices',
      undefined,
      'Short description',
      'Long description',
      50000,
      undefined,
      'out_of_stock',
      'https://images.unsplash.com/photo-1600003263720-95b45a4035d5',
      [],
      '1 Year',
      true,
      true,
      'approved',
      false, // isPreOrderEnabled is false
      true, // hasRetailPrice is true
      true,
      0, // Zero stock quantity
      {}
    );

    expect(product.canBePublished()).toBe(false);
  });

  it('should accept publishing if all essential catalog fields are valid', () => {
    const product = new ProductEntity(
      'test-id-4',
      'GP-TEST-004',
      'GP-MOD-4',
      'Test Charger',
      'test-charger',
      'Power Devices',
      undefined,
      'Short description',
      'Long description',
      50000,
      undefined,
      'in_stock',
      'https://images.unsplash.com/photo-1600003263720-95b45a4035d5',
      [],
      '1 Year',
      true,
      true,
      'approved',
      false,
      true, // hasRetailPrice is true
      true, // hasImage is true
      10, // Stock quantity > 0
      {}
    );

    expect(product.canBePublished()).toBe(true);
  });
});
