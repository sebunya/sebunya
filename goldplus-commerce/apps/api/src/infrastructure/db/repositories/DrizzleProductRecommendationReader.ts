import { and, eq, inArray, notInArray, asc } from "drizzle-orm";
import type {
  IProductRecommendationReader,
  RecommendationProductRecord,
} from "../../../application/ports/IProductRecommendationReader";
import { db } from "../client";
import { products, categories, productPrices } from "../schema/products";
import { productImages } from "../schema/phase11";
import { recommendationMaterializedCache } from "../schema/recommendations";

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

    if (rows.length === 0) return null;
    const enriched = await this.enrichProducts(rows);
    return enriched[0] ?? null;
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

    return this.enrichProducts(rows);
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

    return this.enrichProducts(rows);
  }

  private async enrichProducts(rows: any[]): Promise<RecommendationProductRecord[]> {
    if (rows.length === 0) return [];
    const productIds = rows.map((r) => r.product.id);

    const [priceRows, imageRows] = await Promise.all([
      db.query.productPrices.findMany({ where: inArray(productPrices.productId, productIds) }),
      db.query.productImages.findMany({
        where: inArray(productImages.productId, productIds),
        orderBy: [asc(productImages.displayOrder)],
      }),
    ]);

    const priceByProduct = new Map(priceRows.map((p) => [p.productId, p.retailPrice]));
    const primaryImageByProduct = new Map<string, string>();
    for (const img of imageRows) {
      if (!primaryImageByProduct.has(img.productId) || img.isPrimary) {
        primaryImageByProduct.set(img.productId, img.url);
      }
    }

    return rows.map((row) =>
      this.mapProduct(
        row.product,
        row.category,
        priceByProduct.get(row.product.id),
        primaryImageByProduct.get(row.product.id)
      )
    );
  }

  private mapProduct(
    product: any,
    category?: any,
    joinedPrice?: number,
    joinedImageUrl?: string
  ): RecommendationProductRecord {
    // Fallback securely if no joined value was recovered
    const finalPrice = typeof joinedPrice === 'number' ? joinedPrice : product.priceUgx;
    const finalImageUrl = joinedImageUrl ?? product.imageUrl;

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.shortDescription ?? product.longDescription,
      categoryId: product.categoryId,
      categorySlug: category?.slug,
      categoryName: category?.name,
      imageUrl: finalImageUrl,
      price: typeof finalPrice === 'number' ? finalPrice : undefined,
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

  async findCachedRecommendations(placement: string, contextKey: string): Promise<any[] | null> {
    const row = await db.query.recommendationMaterializedCache.findFirst({
      where: and(
        eq(recommendationMaterializedCache.placement, placement),
        eq(recommendationMaterializedCache.contextKey, contextKey)
      )
    });
    return row ? row.items : null;
  }

  async saveCachedRecommendations(placement: string, contextKey: string, items: any[]): Promise<void> {
    const existing = await db.query.recommendationMaterializedCache.findFirst({
      where: and(
        eq(recommendationMaterializedCache.placement, placement),
        eq(recommendationMaterializedCache.contextKey, contextKey)
      )
    });

    if (existing) {
      await db
        .update(recommendationMaterializedCache)
        .set({
          items,
          updatedAt: new Date()
        })
        .where(eq(recommendationMaterializedCache.id, existing.id));
    } else {
      await db.insert(recommendationMaterializedCache).values({
        placement,
        contextKey,
        items,
        updatedAt: new Date()
      });
    }
  }
}
