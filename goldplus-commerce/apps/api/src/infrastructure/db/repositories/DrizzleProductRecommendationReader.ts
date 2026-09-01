import { and, desc, eq, gt, gte, inArray, notInArray, asc, sql } from "drizzle-orm";
import type {
  IProductRecommendationReader,
  RecommendationProductRecord,
} from "../../../application/ports/IProductRecommendationReader";
import { db } from "../client";
import { products, categories, productPrices } from "../schema/products";
import { orders, orderItems } from "../schema/commerce";
import { productCompatibilityMappings } from "../schema/compatibility";
import { experienceProfiles } from "../schema/experience";
import { productImages } from "../schema/phase11";
import { recommendationMaterializedCache } from "../schema/recommendations";
import { displayUrlMap } from '../mediaDisplayUrl';

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
    orderBy?: "stable" | "newest";
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

    // R3: canonical availability in SQL — available-to-promise means what
    // RESERVE-1 says it means: stock minus active reservations, clamped at
    // zero. The old in-memory check inferred stock from text and defaulted to
    // "in stock" when it knew nothing.
    conditions.push(gt(sql`${products.stockQuantity} - ${products.reservedQuantity}`, 0));

    const rows = await db
      .select({
        product: products,
        category: categories,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(conditions.length ? and(...conditions) : undefined)
      // Deterministic always: "whatever order the planner returned" was the
      // entire ordering of the old fallback path.
      .orderBy(
        ...(input?.orderBy === "newest"
          ? [desc(products.createdAt), asc(products.id)]
          : [asc(products.name), asc(products.id)]),
      )
      .limit(input?.limit ?? 200);

    return this.enrichProducts(rows);
  }

  async findBestsellerProductIds(input: {
    categoryId?: string;
    sinceDays?: number;
    limit: number;
  }): Promise<Array<{ productId: string; unitsSold: number }>> {
    const conditions = [eq(orders.paymentStatus, "paid")];
    if (input.sinceDays) {
      conditions.push(gte(orders.createdAt, sql`now() - make_interval(days => ${input.sinceDays})`));
    }
    if (input.categoryId) {
      conditions.push(eq(products.categoryId, input.categoryId));
    }

    const rows = await db
      .select({
        productId: orderItems.productId,
        unitsSold: sql<number>`sum(${orderItems.quantity})::int`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(and(...conditions))
      .groupBy(orderItems.productId)
      .orderBy(desc(sql`sum(${orderItems.quantity})`), asc(orderItems.productId))
      .limit(input.limit);

    return rows;
  }

  async findCompatibilityTargetIds(productId: string, limit: number): Promise<string[]> {
    const rows = await db
      .select({ targetProductId: productCompatibilityMappings.targetProductId })
      .from(productCompatibilityMappings)
      .where(eq(productCompatibilityMappings.productId, productId))
      .orderBy(asc(productCompatibilityMappings.targetProductId))
      .limit(limit);
    return rows.map((r) => r.targetProductId).filter((id): id is string => typeof id === "string");
  }

  async findRecentPaidProductIdsForProfile(profileId: string, sinceDays: number): Promise<string[]> {
    const rows = await db
      .select({ productId: orderItems.productId })
      .from(experienceProfiles)
      .innerJoin(orders, eq(orders.userId, experienceProfiles.customerId))
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(experienceProfiles.id, profileId),
          eq(orders.paymentStatus, "paid"),
          gte(orders.createdAt, sql`now() - make_interval(days => ${sinceDays})`),
        ),
      )
      .limit(200);
    return [...new Set(rows.map((r) => r.productId))];
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
    const floorByProduct = new Map(priceRows.map((p) => [p.productId, p.floorPrice ?? null]));
    const display = await displayUrlMap(imageRows);
    const primaryImageByProduct = new Map<string, string>();
    for (const img of imageRows) {
      if (!primaryImageByProduct.has(img.productId) || img.isPrimary) {
        primaryImageByProduct.set(img.productId, display.get(img.url) ?? img.url);
      }
    }

    return rows.map((row) =>
      this.mapProduct(
        row.product,
        row.category,
        priceByProduct.get(row.product.id),
        primaryImageByProduct.get(row.product.id),
        floorByProduct.get(row.product.id) ?? null,
      )
    );
  }

  private mapProduct(
    product: any,
    category?: any,
    joinedPrice?: number,
    joinedImageUrl?: string,
    joinedFloor: number | null = null,
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
      floorPriceUgx: joinedFloor,
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

  async findCachedRecommendations(
    placement: string,
    contextKey: string,
  ): Promise<{ items: unknown[]; updatedAt: Date } | null> {
    const row = await db.query.recommendationMaterializedCache.findFirst({
      where: and(
        eq(recommendationMaterializedCache.placement, placement),
        eq(recommendationMaterializedCache.contextKey, contextKey)
      )
    });
    if (!row) return null;
    // The materializer historically wrapped items in a double-encoded JSON
    // string; tolerate both shapes rather than serving nothing.
    const items = typeof row.items === "string" ? JSON.parse(row.items) : row.items;
    return Array.isArray(items) ? { items, updatedAt: row.updatedAt } : null;
  }

  async saveCachedRecommendations(placement: string, contextKey: string, items: unknown[]): Promise<void> {
    const existing = await db.query.recommendationMaterializedCache.findFirst({
      where: and(
        eq(recommendationMaterializedCache.placement, placement),
        eq(recommendationMaterializedCache.contextKey, contextKey)
      )
    });

    // R3.1 (AC21): canonical JSONB, written exactly once.
    //
    // An ARRAY must be stringified and bound as TEXT before the cast. Binding a
    // raw JS array lets postgres.js infer a Postgres ARRAY, and `::jsonb` on an
    // array/record fails with "cannot cast type record to jsonb" — which is
    // precisely what broke this cron hourly from 2026-08-06 and froze the cache.
    //
    // The object writer next door (`${event.metadata ?? {}}::jsonb`) is correct
    // as-is: postgres.js serializes a plain OBJECT to json once. The two are
    // not interchangeable, and that is the whole bug.
    //
    // The read path keeps its tolerance for historic string-typed rows (AC22).
    const canonicalItems = sql`${JSON.stringify(items ?? [])}::text::jsonb`;
    if (existing) {
      await db
        .update(recommendationMaterializedCache)
        .set({
          items: canonicalItems as never,
          updatedAt: new Date()
        })
        .where(eq(recommendationMaterializedCache.id, existing.id));
    } else {
      await db.insert(recommendationMaterializedCache).values({
        placement,
        contextKey,
        items: canonicalItems as never,
        updatedAt: new Date()
      });
    }
  }
}
