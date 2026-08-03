import { IReviewRepository, ReviewStatus } from '../../ports/IReviewRepository';
import { detectReviewPii } from '../../../domain/reviews/ReviewDomain';
import { hashCustomerPhoneIdentity } from '../../../domain/pricing/CustomerIdentity';

export interface SubmitReviewInput {
  productId: string;
  orderItemId?: string | null;
  customerPhone: string;
  rating: number;
  title?: string | null;
  body?: string | null;
}

export type SubmitReviewResult =
  | { ok: true; reviewId: string; status: ReviewStatus; isVerifiedPurchase: boolean; flagged: boolean }
  | { ok: false; reason: 'INVALID_RATING' | 'ORDER_LINE_NOT_FOUND' | 'ORDER_NOT_OWNED' | 'ALREADY_REVIEWED' };

/**
 * U3 — submit a review. Verification is COMPUTED here (order line resolves to a
 * delivered order owned by the same phone-derived identity) and never trusted
 * from input. Content is PII-scanned; a review with a phone/email is FLAGGED and
 * never auto-published. One review per identity per product is enforced by the DB.
 */
export class SubmitReviewUseCase {
  constructor(private readonly reviews: IReviewRepository, private readonly pepper: string) {}

  async execute(input: SubmitReviewInput): Promise<SubmitReviewResult> {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      return { ok: false, reason: 'INVALID_RATING' };
    }
    const identityHash = hashCustomerPhoneIdentity(input.customerPhone, this.pepper);
    const orderItemId = input.orderItemId ?? null;
    let isVerifiedPurchase = false;

    if (orderItemId) {
      const line = await this.reviews.resolveOrderLine(orderItemId);
      if (!line) return { ok: false, reason: 'ORDER_LINE_NOT_FOUND' };
      // AC1 — an order line owned by a DIFFERENT customer is rejected outright.
      const orderIdentity = hashCustomerPhoneIdentity(line.orderPhone, this.pepper);
      if (orderIdentity !== identityHash) return { ok: false, reason: 'ORDER_NOT_OWNED' };
      // Verified only when the owning order is delivered (completed).
      isVerifiedPurchase = line.orderStatus === 'completed';
    }

    const pii = detectReviewPii(input.title, input.body);
    const status: ReviewStatus = pii.hasPii ? 'flagged' : 'pending'; // never auto-published

    const result = await this.reviews.insertReview({
      productId: input.productId,
      orderItemId,
      customerIdentityHash: identityHash,
      rating: input.rating,
      title: input.title ?? null,
      body: input.body ?? null,
      isVerifiedPurchase,
      status,
      flagReason: pii.hasPii ? `PII:${pii.kinds.join(',')}` : null,
    });
    if ('conflict' in result) return { ok: false, reason: 'ALREADY_REVIEWED' };
    return { ok: true, reviewId: result.id, status, isVerifiedPurchase, flagged: pii.hasPii };
  }
}
