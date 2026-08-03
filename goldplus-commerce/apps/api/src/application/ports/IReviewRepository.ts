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
}
