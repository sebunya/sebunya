import { and, eq, inArray, notInArray } from "drizzle-orm";
import type {
  IProductRecommendationReader,
  RecommendationProductRecord,
} from "../../../application/ports/IProductRecommendationReader";
import { db } from "../client";
import { products, categories } from "../schema/products";

export class DrizzleProductRecommendationReader implements IProductRecommendationReader {
  async findProductById(productId: string): Promise<RecommendationProductRecord | null> {
    const rows = await db
      .select({
        product: products,
        category: categories,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.id, productId))
      .limit(1);

    return rows[0] ? this.mapProduct(rows[0].product, rows[0].category) : null;
  }

  async findProductsByIds(productIds: string[]): Promise<RecommendationProductRecord[]> {
    if (productIds.length === 0) return [];

    const rows = await db
      .select({
        product: products,
        category: categories,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(inArray(products.id, productIds));

    return rows.map((row) => this.mapProduct(row.product, row.category));
  }

  async findPublicProducts(input?: {
    categoryId?: string;
    categorySlug?: string;
    productIds?: string[];
    excludeProductIds?: string[];
    limit?: number;
  }): Promise<RecommendationProductRecord[]> {
    
    let targetCategoryId = input?.categoryId;

    // Resolve slug if needed
    if (!targetCategoryId && input?.categorySlug) {
      const cat = await db.query.categories.findFirst({
         where: eq(categories.slug, input.categorySlug)
      });
      if (cat) {
        targetCategoryId = cat.id;
      } else {
        return []; // Cat not found
      }
    }

    const conditions = [];

    // Only valid public products
    conditions.push(eq(products.approvalStatus, 'approved'));
    conditions.push(eq(products.active, true));

    if (targetCategoryId) {
      conditions.push(eq(products.categoryId, targetCategoryId));
    }

    if (input?.productIds?.length) {
      conditions.push(inArray(products.id, input.productIds));
    }

    if (input?.excludeProductIds?.length) {
      conditions.push(notInArray(products.id, input.excludeProductIds));
    }

    const rows = await db
      .select({
        product: products,
        category: categories,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .limit(input?.limit ?? 200);

    return rows.map((row) => this.mapProduct(row.product, row.category));
  }

  private mapProduct(product: any, category?: any): RecommendationProductRecord {
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.shortDescription ?? product.longDescription,
      categoryId: product.categoryId,
      categorySlug: category?.slug,
      categoryName: category?.name,
      imageUrl: product.imageUrl,
      price: typeof product.priceUgx === 'number' ? product.priceUgx : undefined,
      currency: "UGX",
      stockStatus: product.stockStatus,
      stockQuantity: product.stockQuantity,
      isActive: product.active,
      isVisible: true,
      isFeatured: false,
      sortPriority: 0,
      tags: Array.isArray(product.features) ? product.features : [],
      specifications: typeof product.specifications === 'object' ? product.specifications : {},
      modelNumber: product.modelNumber,
      createdAt: product.createdAt,
    };
  }
}
