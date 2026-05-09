import { db } from '../client';
import { products } from '../schema/products';
import { eq } from 'drizzle-orm';
import { ProductEntity } from '../../../domain/products/ProductEntity';

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
      result.categoryId,
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
      slug: product.name.toLowerCase().replace(/ /g, '-'), // Generate slug from name
      categoryId: product.categoryId,
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
        categoryId: product.categoryId,
        specifications: product.specifications,
        approvalStatus: product.approvalStatus,
        isPreOrderEnabled: product.isPreOrderEnabled,
        hasRetailPrice: product.hasRetailPrice,
        hasImage: product.hasImage,
        stockQuantity: product.stockQuantity,
      }
    });
  }

}
