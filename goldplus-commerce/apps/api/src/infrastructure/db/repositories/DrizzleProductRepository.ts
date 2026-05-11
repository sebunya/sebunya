import { db } from '../client';
import { products } from '../schema/products';
import { eq } from 'drizzle-orm';
import { ProductEntity, StockStatus } from '../../../domain/products/ProductEntity';

export class DrizzleProductRepository {
  async findBySlug(slug: string): Promise<ProductEntity | null> {
    const result = await db.query.products.findFirst({
      where: eq(products.slug, slug),
    });

    if (!result) return null;

    return new ProductEntity(
      result.id,
      result.sku,
      result.modelNumber,
      result.name,
      result.slug,
      result.categoryName ?? 'Uncategorized',
      result.subcategory ?? undefined,
      result.shortDescription,
      result.longDescription,
      result.priceUgx,
      result.compareAtPriceUgx ?? undefined,
      result.stockStatus as StockStatus,
      result.imageUrl ?? undefined,
      result.features as string[],
      result.warrantyPeriod,
      result.verificationEligible,
      result.active,
      result.approvalStatus as 'draft' | 'approved' | 'rejected',
      result.isPreOrderEnabled,
      result.hasRetailPrice,
      result.hasImage,
      result.stockQuantity,
      result.specifications as Record<string, string | number>
    );
  }

  async findById(id: string): Promise<ProductEntity | null> {
    const result = await db.query.products.findFirst({
      where: eq(products.id, id),
    });

    if (!result) return null;

    return new ProductEntity(
      result.id,
      result.sku,
      result.modelNumber,
      result.name,
      result.slug,
      result.categoryName ?? 'Uncategorized',
      result.subcategory ?? undefined,
      result.shortDescription,
      result.longDescription,
      result.priceUgx,
      result.compareAtPriceUgx ?? undefined,
      result.stockStatus as StockStatus,
      result.imageUrl ?? undefined,
      result.features as string[],
      result.warrantyPeriod,
      result.verificationEligible,
      result.active,
      result.approvalStatus as 'draft' | 'approved' | 'rejected',
      result.isPreOrderEnabled,
      result.hasRetailPrice,
      result.hasImage,
      result.stockQuantity,
      result.specifications as Record<string, string | number>
    );
  }

  async save(product: ProductEntity): Promise<void> {
    await db.insert(products).values({
      id: product.id,
      sku: product.sku,
      modelNumber: product.modelNumber,
      name: product.name,
      slug: product.slug,
      categoryId: '00000000-0000-0000-0000-000000000000', // Generic Category placeholder
      categoryName: product.category,
      subcategory: product.subcategory,
      shortDescription: product.shortDescription,
      longDescription: product.longDescription,
      priceUgx: product.priceUgx,
      compareAtPriceUgx: product.compareAtPriceUgx,
      stockStatus: product.stockStatus,
      imageUrl: product.imageUrl,
      features: product.features,
      warrantyPeriod: product.warrantyPeriod,
      verificationEligible: product.verificationEligible,
      active: product.active,
      specifications: product.specifications,
      approvalStatus: product.approvalStatus,
      isPreOrderEnabled: product.isPreOrderEnabled,
      hasRetailPrice: product.hasRetailPrice,
      hasImage: product.hasImage,
      stockQuantity: product.stockQuantity,
    }).onConflictDoUpdate({
      target: products.id,
      set: {
        sku: product.sku,
        modelNumber: product.modelNumber,
        name: product.name,
        categoryName: product.category,
        priceUgx: product.priceUgx,
        approvalStatus: product.approvalStatus,
        stockQuantity: product.stockQuantity,
      }
    });
  }

  async findAll(): Promise<ProductEntity[]> {
    const results = await db.query.products.findMany();
    return results.map(result => new ProductEntity(
      result.id,
      result.sku,
      result.modelNumber,
      result.name,
      result.slug,
      result.categoryName ?? 'Uncategorized',
      result.subcategory ?? undefined,
      result.shortDescription,
      result.longDescription,
      result.priceUgx,
      result.compareAtPriceUgx ?? undefined,
      result.stockStatus as StockStatus,
      result.imageUrl ?? undefined,
      result.features as string[],
      result.warrantyPeriod,
      result.verificationEligible,
      result.active,
      result.approvalStatus as 'draft' | 'approved' | 'rejected',
      result.isPreOrderEnabled,
      result.hasRetailPrice,
      result.hasImage,
      result.stockQuantity,
      result.specifications as Record<string, string | number>
    ));
  }
}

