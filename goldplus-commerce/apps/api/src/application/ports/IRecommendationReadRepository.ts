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

/**
 * Read-only aggregate queries over real first-party signals
 * (activity_events + orders). All co-occurrence is computed from
 * genuine interactions — nothing is invented.
 */
export interface IRecommendationReadRepository {
  /** "Customers who viewed this also viewed" — from PRODUCT_VIEW events. */
  getCoViewed(productId: string, limit: number): Promise<CoOccurrenceResult>;

  /** "Frequently bought together" — from items sharing an order. */
  getCoPurchased(productId: string, limit: number): Promise<CoOccurrenceResult>;

  /** Combined signal used to seed personalised similar-item lookups. */
  getSimilarForAnchor(productId: string, limit: number): Promise<CoOccurrenceResult>;

  /** Trending / best-seller fallback for cold start. */
  getPopularProducts(opts: { sinceDays: number; limit: number; categoryId?: string }): Promise<PopularProduct[]>;

  /** A person's recent interactions, newest first, for personalisation. */
  getRecentInteractions(identity: RecommendationIdentity, limit: number): Promise<RecentInteraction[]>;

  /** Product ids the person already bought — excluded from recommendations. */
  getPurchasedProductIds(identity: RecommendationIdentity): Promise<string[]>;
}
