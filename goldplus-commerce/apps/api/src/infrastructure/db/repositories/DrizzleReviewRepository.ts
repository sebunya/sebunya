import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { reviews, productRatingAggregate } from '../schema/reviews';
import { orders, orderItems } from '../schema/commerce';
import { IReviewRepository, InsertReviewInput, ReviewStatus } from '../../../application/ports/IReviewRepository';
import { RatingAggregate, computeRatingAggregate } from '../../../domain/reviews/ReviewDomain';

export class DrizzleReviewRepository implements IReviewRepository {
  async resolveOrderLine(orderItemId: string): Promise<{ orderPhone: string; orderStatus: string } | null> {
    const rows = await db
      .select({ orderPhone: orders.customerPhone, orderStatus: orders.status })
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
}
