import { ProductFinderCatalogItem } from '../../services/product-finder/ProductFinderRecommendationEngine';

export interface ProductFinderCatalogRepository {
  findEligibleProducts(): Promise<ProductFinderCatalogItem[]>;
  findProductsByCategory(categoryName: string): Promise<ProductFinderCatalogItem[]>;
  findProductsByIds(productIds: string[]): Promise<ProductFinderCatalogItem[]>;
  getCategorySummary(): Promise<string[]>;
  getPriceRangeSummary(): Promise<{ min: number; max: number } | null>;
}
