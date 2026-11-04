import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../client';
import { reviews, productRatingAggregate, reviewVotes } from '../schema/reviews';
import { orders, orderItems } from '../schema/commerce';
import { products } from '../schema/products';
import { IReviewRepository, InsertReviewInput, PublicReview, ReviewStatus } from '../../../application/ports/IReviewRepository';
import { RatingAggregate, computeRatingAggregate } from '../../../domain/reviews/ReviewDomain';

/** 0209: the review's attached photo ids, oldest first (an array column from a correlated subquery). */
const PHOTO_IDS = sql<string[]>`coalesce((select array_agg(p.id::text order by p.created_at) from review_photos p where p.review_id = ${reviews.id}), '{}')`;

/** The advisory-lock key that serialises one product's rating recompute. */
export function reviewAggregateLockKey(productId: string): string {
  return `review-aggregate:${productId}`;
}

export class DrizzleReviewRepository implements IReviewRepository {
  async resolveOrderLine(orderItemId: string): Promise<{ orderPhone: string; orderStatus: string; productId: string } | null> {
    const rows = await db
      .select({ orderPhone: orders.customerPhone, orderStatus: orders.status, productId: orderItems.productId })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(eq(orderItems.id, orderItemId))
      .limit(1);
    return rows.length ? rows[0] : null;
  }

  async insertReview(input: InsertReviewInput): Promise<{ id: string } | { conflict: true }> {
    const inserted = await db
      .insert(reviews)
      .values({
        productId: input.productId,
        orderItemId: input.orderItemId,
        customerIdentityHash: input.customerIdentityHash,
        rating: input.rating,
        title: input.title,
        body: input.body,
        isVerifiedPurchase: input.isVerifiedPurchase,
        status: input.status,
        flagReason: input.flagReason,
      })
      .onConflictDoNothing() // one review per (product, identity); one per order line
      .returning({ id: reviews.id });
    return inserted.length ? { id: inserted[0].id } : { conflict: true };
  }

  async moderate(input: { reviewId: string; status: ReviewStatus; moderatorId: string; reason: string | null; now: Date }): Promise<{ productId: string } | null> {
    return db.transaction(async (tx) => {
      const [review] = await tx.select({ id: reviews.id, productId: reviews.productId }).from(reviews).where(eq(reviews.id, input.reviewId)).for('update').limit(1);
      if (!review) return null;
      await tx
        .update(reviews)
        .set({
          status: input.status,
          moderatedBy: input.moderatorId,
          moderatedAt: input.now,
          rejectionReason: input.status === 'rejected' ? input.reason : null,
          updatedAt: input.now,
        })
        .where(eq(reviews.id, input.reviewId));
      // Recompute the aggregate from the CURRENT set of published reviews. Doing a
      // full recompute (rather than an incremental delta) makes the aggregate
      // exactly consistent regardless of how many publish/unpublish operations
      // interleave — and it commits in this same transaction.
      await this.recomputeAggregate(tx, review.productId, input.now);
      return { productId: review.productId };
    });
  }

  private async recomputeAggregate(tx: typeof db, productId: string, now: Date): Promise<void> {
    // One recompute per product at a time. Without it two moderations of different reviews of the same
    // product each read only their own change (READ COMMITTED) and the last commit lost the other's.
    // The lock is taken after this transaction's own write, so the read below sees every committed change.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${reviewAggregateLockKey(productId)}))`);
    const rows = await tx.select({ rating: reviews.rating }).from(reviews).where(and(eq(reviews.productId, productId), eq(reviews.status, 'published')));
    const agg = computeRatingAggregate(rows.map((r) => r.rating));
    await tx
      .insert(productRatingAggregate)
      .values({
        productId,
        ratingCount: agg.count,
        ratingSum: agg.sum,
        ratingAverage: agg.average == null ? null : String(agg.average),
        distribution: agg.distribution,
        lastRecomputedAt: now,
      })
      .onConflictDoUpdate({
        target: productRatingAggregate.productId,
        set: {
          ratingCount: agg.count,
          ratingSum: agg.sum,
          ratingAverage: agg.average == null ? null : String(agg.average),
          distribution: agg.distribution,
          lastRecomputedAt: now,
        },
      });
  }

  /** The moderation queue. Carries the product's name and slug so a moderator sees WHAT the review is about. */
  async listByStatus(status: ReviewStatus, limit = 100): Promise<Array<{ id: string; productId: string; productName: string | null; productSlug: string | null; photoIds: string[]; rating: number; title: string | null; body: string | null; status: string; isVerifiedPurchase: boolean; flagReason: string | null; createdAt: Date; staffReply: string | null }>> {
    const rows = await db
      .select({ id: reviews.id, productId: reviews.productId, productName: products.name, productSlug: products.slug, rating: reviews.rating, title: reviews.title, body: reviews.body, status: reviews.status, photoIds: PHOTO_IDS, isVerifiedPurchase: reviews.isVerifiedPurchase, flagReason: reviews.flagReason, createdAt: reviews.createdAt, staffReply: reviews.staffReply })
      .from(reviews)
      .leftJoin(products, eq(products.id, reviews.productId))
      .where(eq(reviews.status, status))
      .orderBy(desc(reviews.createdAt))
      .limit(Math.min(limit, 500));
    return rows;
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await db.select({ status: reviews.status, n: sql<number>`count(*)::int` }).from(reviews).groupBy(reviews.status);
    const out: Record<string, number> = { pending: 0, published: 0, rejected: 0, flagged: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  async getAggregate(productId: string): Promise<RatingAggregate | null> {
    const [row] = await db.select().from(productRatingAggregate).where(eq(productRatingAggregate.productId, productId)).limit(1);
    if (!row) return null;
    return {
      count: row.ratingCount,
      sum: row.ratingSum,
      average: row.ratingAverage == null ? null : Number(row.ratingAverage),
      distribution: (row.distribution ?? {}) as Record<string, number>,
    };
  }

  async findOrderLineId(orderNumber: string, productId: string): Promise<string | null> {
    const rows = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orders.orderNumber, orderNumber), eq(orderItems.productId, productId)))
      .limit(1);
    return rows.length ? rows[0].id : null;
  }

  async reviewedProductIds(customerIdentityHash: string, productIds: string[]): Promise<Set<string>> {
    if (productIds.length === 0) return new Set();
    const rows = await db
      .select({ productId: reviews.productId })
      .from(reviews)
      .where(and(eq(reviews.customerIdentityHash, customerIdentityHash), inArray(reviews.productId, productIds)));
    return new Set(rows.map((r) => r.productId));
  }

  async listPublished(productId: string, limit: number): Promise<PublicReview[]> {
    const helpful = sql<number>`(select count(*)::int from review_votes v where v.review_id = ${reviews.id} and v.vote = 'helpful')`;
    const rows = await db
      .select({ id: reviews.id, rating: reviews.rating, title: reviews.title, body: reviews.body, isVerifiedPurchase: reviews.isVerifiedPurchase, createdAt: reviews.createdAt, helpfulCount: helpful, photoIds: PHOTO_IDS, staffReply: reviews.staffReply, staffRepliedAt: reviews.staffRepliedAt })
      .from(reviews)
      .where(and(eq(reviews.productId, productId), eq(reviews.status, 'published')))
      .orderBy(desc(helpful), desc(reviews.createdAt))
      .limit(Math.max(1, Math.min(limit, 50)));
    return rows.map(({ staffReply, staffRepliedAt, ...r }) => ({
      ...r,
      helpfulCount: Number(r.helpfulCount ?? 0),
      photoIds: Array.isArray(r.photoIds) ? r.photoIds.map(String) : [],
      staffReply: staffReply && staffRepliedAt ? { body: staffReply, at: staffRepliedAt } : null,
    }));
  }

  async reply(input: { reviewId: string; body: string; now: Date }): Promise<{ productId: string } | null> {
    const body = input.body.trim();
    const [row] = await db
      .update(reviews)
      .set(body ? { staffReply: body, staffRepliedAt: input.now, updatedAt: input.now } : { staffReply: null, staffRepliedAt: null, updatedAt: input.now })
      .where(eq(reviews.id, input.reviewId))
      .returning({ productId: reviews.productId });
    return row ? { productId: row.productId } : null;
  }

  async recordVote(input: { reviewId: string; voterIdentityHash: string; vote: 'helpful' | 'not_helpful' }): Promise<'recorded' | 'not_found'> {
    const [published] = await db.select({ id: reviews.id }).from(reviews).where(and(eq(reviews.id, input.reviewId), eq(reviews.status, 'published'))).limit(1);
    if (!published) return 'not_found';
    await db
      .insert(reviewVotes)
      .values({ reviewId: input.reviewId, voterIdentityHash: input.voterIdentityHash, vote: input.vote })
      .onConflictDoUpdate({ target: [reviewVotes.reviewId, reviewVotes.voterIdentityHash], set: { vote: input.vote, createdAt: new Date() } });
    return 'recorded';
  }
}
