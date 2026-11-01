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
  /** 0127 — the product's own floor (Price A); null = not discountable. */
  floorPriceUgx?: number | null;
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
  /**
   * Eligible public products, deterministically ordered. R3: eligibility is
   * the CANONICAL commerce truth enforced in SQL — approved, active, and
   * available-to-promise (stock_quantity − reserved_quantity > 0, the
   * RESERVE-1 columns); ordering is stable (name, id) or newest-first,
   * never "whatever the planner returned".
   */
  findPublicProducts(input?: {
    categoryId?: string;
    categorySlug?: string;
    productIds?: string[];
    excludeProductIds?: string[];
    limit?: number;
    orderBy?: "stable" | "newest";
  }): Promise<RecommendationProductRecord[]>;

  findProductById(productId: string): Promise<RecommendationProductRecord | null>;

  findProductsByIds(productIds: string[]): Promise<RecommendationProductRecord[]>;

  /**
   * Units sold per product from PAID orders only (RFM-1 discipline: unpaid
   * orders never inflate popularity). Deterministic: units desc, product asc.
   * Empty result = no paid evidence — the caller reports INSUFFICIENT_SAMPLE
   * instead of fabricating a bestseller list.
   */
  findBestsellerProductIds(input: {
    categoryId?: string;
    sinceDays?: number;
    limit: number;
  }): Promise<Array<{ productId: string; unitsSold: number }>>;

  /** Curated exact-compatibility targets for an anchor product (empty today — reported, not faked). */
  findCompatibilityTargetIds(productId: string, limit: number): Promise<string[]>;

  /** Product ids this profile's customer PAID for recently — for post-purchase suppression (§5A.9). */
  findRecentPaidProductIdsForProfile(profileId: string, sinceDays: number): Promise<string[]>;

  findCachedRecommendations(
    placement: string,
    contextKey: string,
  ): Promise<{ items: unknown[]; updatedAt: Date } | null>;

  saveCachedRecommendations(placement: string, contextKey: string, items: unknown[]): Promise<void>;
}
