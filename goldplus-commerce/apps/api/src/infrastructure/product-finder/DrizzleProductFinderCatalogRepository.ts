import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { products, categories } from "../db/schema/products";
import { ProductFinderCatalogRepository } from "../../application/ports/product-finder/ProductFinderCatalogRepository";
import { ProductFinderCatalogItem } from "../../application/services/product-finder/ProductFinderRecommendationEngine";
import { productPrices } from "../db/schema/products";
import { productCompatibilityMappings } from "../db/schema/compatibility";

export class DrizzleProductFinderCatalogRepository implements ProductFinderCatalogRepository {
  async findEligibleProducts(): Promise<ProductFinderCatalogItem[]> {
    return this.queryEligible();
  }

  async findEligibleProductsForReference(
    referenceProductId: string,
  ): Promise<ProductFinderCatalogItem[]> {
    const mappings = await db
      .select()
      .from(productCompatibilityMappings)
      .where(
        and(
          eq(productCompatibilityMappings.productId, referenceProductId),
          eq(productCompatibilityMappings.enabled, true),
          inArray(productCompatibilityMappings.verdict, [
            "exact",
            "compatible",
            "conditional",
          ]),
        ),
      );
    if (!mappings.length) return [];
    const byTarget = new Map(
      mappings.map((item) => [item.targetProductId, item]),
    );
    return (await this.queryEligible([...byTarget.keys()])).map((item) => {
      const mapping = byTarget.get(item.productId)!;
      return {
        ...item,
        compatibilityVerdict: mapping.verdict as
          | "exact"
          | "compatible"
          | "conditional",
        compatibilityNote: mapping.note,
      };
    });
  }

  private async queryEligible(
    ids?: string[],
  ): Promise<ProductFinderCatalogItem[]> {
    const conditions = [
      eq(products.active, true),
      eq(products.approvalStatus, "approved"),
      eq(products.hasRetailPrice, true),
      eq(products.hasImage, true),
      gt(sql`${products.stockQuantity} - ${products.reservedQuantity}`, 0),
    ];
    if (ids) conditions.push(inArray(products.id, ids));
    const rows = await db
      .select({
        product: products,
        category: categories,
      })
      .from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(and(...conditions));
    const prices = rows.length
      ? await db
          .select()
          .from(productPrices)
          .where(
            inArray(
              productPrices.productId,
              rows.map((row) => row.product.id),
            ),
          )
      : [];
    const priceByProduct = new Map(
      prices.map((row) => [row.productId, row.retailPrice]),
    );

    return rows
      .filter((r) => priceByProduct.has(r.product.id))
      .map((r) => ({
        productId: r.product.id,
        slug: r.product.slug,
        sku: r.product.sku,
        name: r.product.name,
        categoryId: r.category.id,
        categoryName: r.category.name,
        subcategory: r.product.subcategory,
        priceUgx: priceByProduct.get(r.product.id)!,
        stockStatus: r.product.stockStatus,
        imageUrl: r.product.imageUrl,
        features: r.product.features || [],
        availableQuantity: Math.max(
          0,
          r.product.stockQuantity - r.product.reservedQuantity,
        ),
      }));
  }

  async findProductsByCategory(
    categoryName: string,
  ): Promise<ProductFinderCatalogItem[]> {
    const all = await this.findEligibleProducts();
    return all.filter(
      (p) => p.categoryName?.toLowerCase() === categoryName.toLowerCase(),
    );
  }

  async findProductsByIds(
    productIds: string[],
  ): Promise<ProductFinderCatalogItem[]> {
    if (!productIds.length) return [];

    return this.queryEligible(productIds);
  }

  async getCategorySummary(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ name: categories.name })
      .from(categories);
    return rows.map((r) => r.name);
  }

  async getPriceRangeSummary(): Promise<{ min: number; max: number } | null> {
    const eligible = await this.findEligibleProducts();
    if (!eligible.length) return null;
    const prices = eligible.map((item) => item.priceUgx);
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }
}
