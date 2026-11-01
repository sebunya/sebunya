import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Saving a product must actually save it, and creating one must be possible.
 *
 * TWO DEFECTS, both found by the audit and both confirmed against production.
 *
 * 1. NO PRODUCT COULD BE CREATED THROUGH THE ADMIN.
 *    The INSERT wrote a placeholder categoryId of all zeroes and relied on a
 *    follow-up UPDATE to correct it. `products.category_id` is NOT NULL behind a
 *    NON-DEFERRABLE foreign key, and production holds zero categories with that
 *    id, so the INSERT always raised a foreign-key violation and
 *    POST /admin/products answered 500 "An unexpected error occurred."
 *
 * 2. AN EDIT SILENTLY DISCARDED MOST OF ITSELF.
 *    The conflict branch updated six columns. An operator could change the slug,
 *    the descriptions, the subcategory, the compare-at price, the stock status,
 *    the image, the features, the warranty, the specifications or the active
 *    flag, be told "Product updated", and lose all of it.
 */

const src = readFileSync(
  resolve(__dirname, '../../apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts'),
  'utf8',
);
const save = src.slice(src.indexOf('async save('), src.indexOf('async findAll('));
const setBlock = save.slice(save.indexOf('set: {'), save.indexOf('});', save.indexOf('set: {')));

describe('a product row is valid the moment it is inserted', () => {
  it('never writes the all-zero placeholder category', () => {
    expect(src).not.toContain('00000000-0000-0000-0000-000000000000');
  });

  it('writes the real category id in the INSERT itself', () => {
    const values = save.slice(save.indexOf('.values({'), save.indexOf('onConflictDoUpdate'));
    expect(values).toMatch(/\bcategoryId,/);
  });

  it('requires the category id rather than inventing one', () => {
    expect(save).toMatch(/async save\(product: ProductEntity, categoryId: string\)/);
    const port = readFileSync(
      resolve(__dirname, '../../apps/api/src/application/ports/index.ts'),
      'utf8',
    );
    expect(port).toMatch(/save\(product: ProductEntity, categoryId: string\): Promise<void>;/);
  });

  it('no longer needs a second statement to become valid', () => {
    const create = src.slice(src.indexOf('async createProduct('), src.indexOf('async updateProductProperties('));
    expect(create).not.toMatch(/db\.update\(products\)\.set\(\{ categoryId \}\)/);
  });
});

describe('an edit writes everything the operator changed', () => {
  // Every column an operator can edit through /admin/products/[id]/edit-properties.
  const EDITABLE = [
    'sku', 'modelNumber', 'name', 'slug', 'categoryId', 'categoryName', 'subcategory',
    'shortDescription', 'longDescription', 'priceUgx', 'compareAtPriceUgx', 'stockStatus',
    'imageUrl', 'features', 'warrantyPeriod', 'verificationEligible', 'active',
    'specifications', 'approvalStatus', 'isPreOrderEnabled', 'hasRetailPrice', 'hasImage',
  ];

  for (const field of EDITABLE) {
    it(`updates ${field}`, () => {
      expect(setBlock).toMatch(new RegExp(`\\b${field}[,:]`));
    });
  }

  it('still refuses to rewrite stock quantity from a property save', () => {
    // On-hand stock is owned by setStockQuantity, whose conditional UPDATE
    // carries the reserved <= stock invariant. Rewriting it here would reopen
    // the read-then-write window that guard exists to close.
    expect(setBlock).not.toMatch(/\bstockQuantity[,:]/);
  });
});
