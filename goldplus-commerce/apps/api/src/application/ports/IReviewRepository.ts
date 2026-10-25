import { RatingAggregate } from '../../domain/reviews/ReviewDomain';

export type ReviewStatus = 'pending' | 'published' | 'rejected' | 'flagged';

export interface InsertReviewInput {
  productId: string;
  orderItemId: string | null;
  customerIdentityHash: string;
  rating: number;
  title: string | null;
  body: string | null;
  isVerifiedPurchase: boolean;
  status: ReviewStatus;
  flagReason: string | null;
}

/** What a shopper sees of a published review: no name, phone or identity hash. */
export interface PublicReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  isVerifiedPurchase: boolean;
  createdAt: Date;
  /** Shoppers who marked it helpful (gap analysis #10). */
  helpfulCount: number;
  /** 0209: the review's photos, newest last (absent from fakes that predate photos). */
  photoIds?: string[];
}

export interface IReviewRepository {
  /** The order line's owning phone and order status, for verification. */
  resolveOrderLine(orderItemId: string): Promise<{ orderPhone: string; orderStatus: string } | null>;
  /** Insert a review. Returns { conflict: true } if this identity already reviewed
   * this product (or the order line is already reviewed) — one review per identity
   * per product is enforced at the DB boundary. */
  insertReview(input: InsertReviewInput): Promise<{ id: string } | { conflict: true }>;
  /** Change a review's moderation status and, when it enters or leaves 'published',
   * recompute the product's rating aggregate in the SAME transaction. */
  moderate(input: { reviewId: string; status: ReviewStatus; moderatorId: string; reason: string | null; now: Date }): Promise<{ productId: string } | null>;
  getAggregate(productId: string): Promise<RatingAggregate | null>;
  /** The order line id for a product on an order (by order number), or null. */
  findOrderLineId(orderNumber: string, productId: string): Promise<string | null>;
  /** Which of these products this identity has already reviewed (any status). */
  reviewedProductIds(customerIdentityHash: string, productIds: string[]): Promise<Set<string>>;
  /** Published reviews for a product, most helpful first, then newest. */
  listPublished(productId: string, limit: number): Promise<PublicReview[]>;
  /** One vote per voter per review (a second vote replaces the first); only on a published review. */
  recordVote(input: { reviewId: string; voterIdentityHash: string; vote: 'helpful' | 'not_helpful' }): Promise<'recorded' | 'not_found'>;
}
