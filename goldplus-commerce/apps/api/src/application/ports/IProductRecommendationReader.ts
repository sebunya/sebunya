export interface RecommendationProductRecord {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  categorySlug?: string | null;
  categoryName?: string | null;
  imageUrl?: string | null;
  price?: number | null;
  currency?: string | null;
  stockStatus?: string | null;
  stockQuantity?: number | null;
  isActive?: boolean | null;
  isVisible?: boolean | null;
  isFeatured?: boolean | null;
  sortPriority?: number | null;
  tags?: string[] | null;
  specifications?: Record<string, unknown> | null;
  modelNumber?: string | null;
  createdAt?: Date | null;
}

export interface IProductRecommendationReader {
  findPublicProducts(input?: {
    categoryId?: string;
    categorySlug?: string;
    productIds?: string[];
    excludeProductIds?: string[];
    limit?: number;
  }): Promise<RecommendationProductRecord[]>;

  findProductById(productId: string): Promise<RecommendationProductRecord | null>;

  findProductsByIds(productIds: string[]): Promise<RecommendationProductRecord[]>;
}
