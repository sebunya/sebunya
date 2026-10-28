import type { IReviewRepository, PublicReview } from '../../ports/IReviewRepository';
import { REVIEWABLE_ORDER_STATUSES, type RatingAggregate } from '../../../domain/reviews/ReviewDomain';
import { hashCustomerPhoneIdentity } from '../../../domain/pricing/CustomerIdentity';
import { createHash } from 'node:crypto';
import type { SubmitReviewUseCase } from './SubmitReviewUseCase';

/**
 * The customer side of reviews. The order has already been PROVEN by the
 * caller (order reference + the phone or email used at checkout, the same
 * check and lockout as order tracking), so these use cases only ever see the
 * shopper's own order. A review is always tied to a line on that order, so
 * every review reaching the site is a purchase; only a delivered or completed
 * order can be reviewed, so every one is a VERIFIED purchase.
 */
export interface VerifiedOrder {
  orderNumber: string;
  customerPhone: string;
  orderStatus: string;
  items: Array<{ productId: string; name: string }>;
}

export interface ReviewableItem { productId: string; name: string; reviewed: boolean }
export interface OrderReviewEligibility { delivered: boolean; items: ReviewableItem[] }

export class GetOrderReviewEligibilityUseCase {
  constructor(private readonly reviews: IReviewRepository, private readonly pepper: string) {}

  async execute(order: VerifiedOrder): Promise<OrderReviewEligibility> {
    const delivered = REVIEWABLE_ORDER_STATUSES.has(order.orderStatus);
    // One line per product (an order can hold the same product twice).
    const seen = new Set<string>();
    const lines = order.items.filter((it) => it.productId && !seen.has(it.productId) && seen.add(it.productId));
    const reviewed = delivered
      ? await this.reviews.reviewedProductIds(hashCustomerPhoneIdentity(order.customerPhone, this.pepper), lines.map((l) => l.productId))
      : new Set<string>();
    return { delivered, items: lines.map((l) => ({ productId: l.productId, name: l.name, reviewed: reviewed.has(l.productId) })) };
  }
}

export interface SubmitOrderReviewInput { productId: string; rating: number; title?: string | null; body?: string | null; /** 0209: ids of photos uploaded for this review (at most three are kept). */ photoIds?: unknown }
export type SubmitOrderReviewResult =
  | { ok: true; status: string; flagged: boolean; photos?: number }
  | { ok: false; reason: 'NOT_DELIVERED' | 'NOT_ON_ORDER' | 'INVALID_RATING' | 'TOO_LONG' | 'ALREADY_REVIEWED' | 'ORDER_LINE_NOT_FOUND' | 'ORDER_NOT_OWNED' };

export const REVIEW_TITLE_MAX = 140;
export const REVIEW_BODY_MAX = 2000;

export class SubmitOrderReviewUseCase {
  constructor(private readonly reviews: IReviewRepository, private readonly submit: SubmitReviewUseCase, private readonly attachPhotos: (reviewId: string, photoIds: unknown) => Promise<number> = async () => 0) {}

  async execute(order: VerifiedOrder, input: SubmitOrderReviewInput): Promise<SubmitOrderReviewResult> {
    if (!REVIEWABLE_ORDER_STATUSES.has(order.orderStatus)) return { ok: false, reason: 'NOT_DELIVERED' };
    if (!order.items.some((it) => it.productId === input.productId)) return { ok: false, reason: 'NOT_ON_ORDER' };
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) return { ok: false, reason: 'INVALID_RATING' };
    const title = (input.title ?? '').trim() || null;
    const body = (input.body ?? '').trim() || null;
    if ((title?.length ?? 0) > REVIEW_TITLE_MAX || (body?.length ?? 0) > REVIEW_BODY_MAX) return { ok: false, reason: 'TOO_LONG' };
    const lineId = await this.reviews.findOrderLineId(order.orderNumber, input.productId);
    if (!lineId) return { ok: false, reason: 'NOT_ON_ORDER' };
    // The existing submission re-checks ownership against the line and computes "verified"
    // itself; it never trusts these inputs. New reviews wait for a moderator (never auto-published).
    const res = await this.submit.execute({ productId: input.productId, orderItemId: lineId, customerPhone: order.customerPhone, rating: input.rating, title, body });
    if (!res.ok) return { ok: false, reason: res.reason };
    // 0209: the photos uploaded while writing; a failure to attach never loses the review.
    const photos = input.photoIds ? await this.attachPhotos(res.reviewId, input.photoIds).catch(() => 0) : 0;
    return { ok: true, status: res.status, flagged: res.flagged, photos };
  }
}

export interface ProductReviews { aggregate: RatingAggregate | null; reviews: PublicReview[] }

export class GetProductReviewsUseCase {
  constructor(private readonly reviews: IReviewRepository) {}

  async execute(productId: string, limit = 10): Promise<ProductReviews> {
    const [aggregate, list] = await Promise.all([this.reviews.getAggregate(productId), this.reviews.listPublished(productId, limit)]);
    return { aggregate: aggregate && aggregate.count > 0 ? aggregate : null, reviews: list };
  }
}

/**
 * "Was this helpful?" (gap analysis #10). The voter is the visitor's own signed visit token, hashed with the
 * identity pepper so the table holds no reusable identifier. One vote per visitor per review; voting again changes
 * it. A visitor who clears cookies can vote again: the count is a guide for readers, not a ballot, and the public
 * endpoint is rate limited.
 */
export class VoteOnReviewUseCase {
  constructor(private readonly reviews: IReviewRepository, private readonly pepper: string) {}

  async execute(input: { reviewId: string; voterKey: string; vote: string }): Promise<'recorded' | 'not_found' | 'invalid'> {
    if (!/^[0-9a-f-]{36}$/i.test(input.reviewId) || !input.voterKey || input.voterKey.length > 512) return 'invalid';
    if (input.vote !== 'helpful' && input.vote !== 'not_helpful') return 'invalid';
    const voterIdentityHash = createHash('sha256').update(`review-vote|${this.pepper}|${input.voterKey}`).digest('hex');
    return this.reviews.recordVote({ reviewId: input.reviewId, voterIdentityHash, vote: input.vote });
  }
}
