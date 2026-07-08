import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { products, categories } from '../db/schema/products';
import { ProductFinderCatalogRepository } from '../../application/ports/product-finder/ProductFinderCatalogRepository';
import { ProductFinderCatalogItem } from '../../application/services/product-finder/ProductFinderRecommendationEngine';

export class DrizzleProductFinderCatalogRepository implements ProductFinderCatalogRepository {
  async findEligibleProducts(): Promise<ProductFinderCatalogItem[]> {
    const rows = await db.select({
      product: products,
      category: categories
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.active, true));

    return rows.map(r => ({
      productId: r.product.id,
      sku: r.product.sku,
      name: r.product.name,
      categoryId: r.category.id,
      categoryName: r.category.name,
      subcategory: r.product.subcategory,
      priceUgx: r.product.priceUgx,
      stockStatus: r.product.stockStatus,
      imageUrl: r.product.imageUrl,
      features: r.product.features || []
    }));
  }

  async findProductsByCategory(categoryName: string): Promise<ProductFinderCatalogItem[]> {
    const all = await this.findEligibleProducts();
    return all.filter(p => p.categoryName?.toLowerCase() === categoryName.toLowerCase());
  }

  async findProductsByIds(productIds: string[]): Promise<ProductFinderCatalogItem[]> {
    if (!productIds.length) return [];
    
    const rows = await db.select({
      product: products,
      category: categories
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(inArray(products.id, productIds));

    return rows.map(r => ({
      productId: r.product.id,
      sku: r.product.sku,
      name: r.product.name,
      categoryId: r.category.id,
      categoryName: r.category.name,
      subcategory: r.product.subcategory,
      priceUgx: r.product.priceUgx,
      stockStatus: r.product.stockStatus,
      imageUrl: r.product.imageUrl,
      features: r.product.features || []
    }));
  }

  async getCategorySummary(): Promise<string[]> {
    const rows = await db.selectDistinct({ name: categories.name }).from(categories);
    return rows.map(r => r.name);
  }

  async getPriceRangeSummary(): Promise<{ min: number; max: number } | null> {
    return { min: 10000, max: 500000 }; // Stub for now based on catalogue
  }
}
