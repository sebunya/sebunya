import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../client';
import { categories, productPrices, products } from '../schema/products';
import type { BulkTerms, BulkTermsAdminRow, BulkTermsChange, IBulkTermsRepository } from '../../../application/ports/IBulkTermsRepository';

/** Thrown inside the transaction to undo the product write when the price row is missing. */
class NoRetailPrice extends Error {}

const unitOf = (value: string): 'carton' | 'piece' => (value === 'piece' ? 'piece' : 'carton');

export class DrizzleBulkTermsRepository implements IBulkTermsRepository {
  async findOnSale(ids?: string[]): Promise<BulkTerms[]> {
    if (ids && ids.length === 0) return [];
    const rows = await db
      .select({
        productId: products.id,
        bulkUnit: products.bulkUnit,
        unitsPerCarton: products.unitsPerCarton,
        dealerPriceUgx: productPrices.dealerPrice,
      })
      .from(products)
      .leftJoin(productPrices, eq(productPrices.productId, products.id))
      .where(and(
        eq(products.approvalStatus, 'approved'),
        eq(products.active, true),
        ids ? inArray(products.id, ids) : undefined,
      ));
    return rows.map((r) => ({
      productId: r.productId,
      bulkUnit: unitOf(r.bulkUnit),
      unitsPerCarton: r.unitsPerCarton ?? null,
      dealerPriceUgx: r.dealerPriceUgx ?? null,
    }));
  }

  async listForAdmin(): Promise<BulkTermsAdminRow[]> {
    const rows = await db
      .select({
        productId: products.id,
        sku: products.sku,
        modelNumber: products.modelNumber,
        name: products.name,
        categoryName: categories.name,
        approvalStatus: products.approvalStatus,
        active: products.active,
        bulkUnit: products.bulkUnit,
        unitsPerCarton: products.unitsPerCarton,
        retailPriceUgx: productPrices.retailPrice,
        floorPriceUgx: productPrices.floorPrice,
        dealerPriceUgx: productPrices.dealerPrice,
      })
      .from(products)
      .leftJoin(productPrices, eq(productPrices.productId, products.id))
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .orderBy(asc(categories.name), asc(products.sku));
    return rows.map((r) => ({
      productId: r.productId,
      sku: r.sku,
      modelNumber: r.modelNumber,
      name: r.name,
      categoryName: r.categoryName ?? null,
      onSale: r.approvalStatus === 'approved' && r.active === true,
      bulkUnit: unitOf(r.bulkUnit),
      unitsPerCarton: r.unitsPerCarton ?? null,
      retailPriceUgx: r.retailPriceUgx ?? null,
      floorPriceUgx: r.floorPriceUgx ?? null,
      dealerPriceUgx: r.dealerPriceUgx ?? null,
    }));
  }

  async update(productId: string, change: BulkTermsChange): Promise<'updated' | 'not_found' | 'no_retail_price'> {
    return db.transaction(async (tx) => {
      // No updated_at bump: that column is the public page's sitemap lastmod,
      // and nothing on the public product page changes here.
      const updated = await tx
        .update(products)
        .set({ bulkUnit: change.bulkUnit, unitsPerCarton: change.bulkUnit === 'piece' ? null : change.unitsPerCarton })
        .where(eq(products.id, productId))
        .returning({ id: products.id });
      if (updated.length === 0) return 'not_found';
      const priced = await tx
        .update(productPrices)
        .set({ dealerPrice: change.dealerPriceUgx })
        .where(eq(productPrices.productId, productId))
        .returning({ id: productPrices.id });
      // A dealer price cannot exist without the product's price row (its retail price).
      if (priced.length === 0 && change.dealerPriceUgx !== null) {
        throw new NoRetailPrice();
      }
      return 'updated';
    }).catch((err: unknown) => {
      if (err instanceof NoRetailPrice) return 'no_retail_price' as const;
      throw err;
    });
  }
}
