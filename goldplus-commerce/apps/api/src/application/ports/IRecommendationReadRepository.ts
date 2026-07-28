import { CandidateCoOccurrence, InteractionKind } from '../../domain/recommendation/Recommendation';

export interface CoOccurrenceResult {
  /** Overall popularity/support of the anchor item for the given signal. */
  anchorSupport: number;
  candidates: CandidateCoOccurrence[];
}

export interface RecentInteraction {
  productId: string;
  productName: string | null;
  kind: InteractionKind;
  ageDays: number;
}

export interface PopularProduct {
  productId: string;
  score: number;
}

export interface RecommendationIdentity {
  userId?: string | null;
  visitorId?: string | null;
}

/** Commercial context for candidates, sourced from real product columns.
 *  Fields the schema cannot supply are omitted (see ProductCommercialContext). */
export interface RecommendationProductContext {
  productId: string;
  categoryId: string | null;
  categoryName: string | null;
  price: number | null;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock' | 'discontinued' | null;
  stockQty: number | null;
  isNewArrival: boolean;
  isClearance: boolean;
  isPublished: boolean;
}

/**
 * Read-only aggregate queries over real first-party signals
 * (activity_events + orders). All co-occurrence is computed from
 * genuine interactions — nothing is invented.
 */
export interface IRecommendationReadRepository {
  /** "Customers who viewed this also viewed" — from PRODUCT_VIEW events. */
  getCoViewed(productId: string, limit: number): Promise<CoOccurrenceResult>;

  /** "Considered together" — products added to cart alongside the anchor. */
  getCoCarted(productId: string, limit: number, opts?: { sinceDays?: number }): Promise<CoOccurrenceResult>;

  /** "Frequently bought together" — from items sharing an order. */
  getCoPurchased(productId: string, limit: number, opts?: { sinceDays?: number }): Promise<CoOccurrenceResult>;

  /** Combined signal used to seed personalised similar-item lookups. */
  getSimilarForAnchor(productId: string, limit: number): Promise<CoOccurrenceResult>;

  /** Trending / best-seller fallback for cold start (views + carts, recent). */
  getPopularProducts(opts: { sinceDays: number; limit: number; categoryId?: string }): Promise<PopularProduct[]>;

  /** Trending: recent views + add-to-cart, recency-weighted. */
  getTrendingProducts(opts: { sinceDays: number; limit: number; categoryId?: string }): Promise<PopularProduct[]>;

  /** Bestsellers: actual units sold from completed orders in a window. */
  getBestSellingProducts(opts: { sinceDays: number; limit: number; categoryId?: string }): Promise<PopularProduct[]>;

  /** Most-carted: add-to-cart volume (pre-purchase intent). */
  getMostCartedProducts(opts: { sinceDays: number; limit: number; categoryId?: string }): Promise<PopularProduct[]>;

  /** New arrivals: recently created, active products. */
  getNewArrivals(opts: { limit: number; categoryId?: string }): Promise<PopularProduct[]>;

  /** A person's recent interactions (view/cart/purchase), newest first,
   *  with product names for reasons. */
  getRecentInteractions(identity: RecommendationIdentity, limit: number): Promise<RecentInteraction[]>;

  /** Product ids the person already bought — excluded unless replenishable. */
  getPurchasedProductIds(identity: RecommendationIdentity): Promise<string[]>;

  /** Product ids currently in the person's cart — excluded from cross-sell. */
  getCartProductIds(identity: RecommendationIdentity): Promise<string[]>;

  /** Commercial context for candidate products (real columns only). */
  getProductContext(productIds: string[]): Promise<RecommendationProductContext[]>;
}
