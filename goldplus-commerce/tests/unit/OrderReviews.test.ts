import { describe, expect, it } from 'vitest';
import { GetOrderReviewEligibilityUseCase, GetProductReviewsUseCase, SubmitOrderReviewUseCase, type VerifiedOrder } from '../../apps/api/src/application/use-cases/reviews/OrderReviewUseCases';
import { SubmitReviewUseCase } from '../../apps/api/src/application/use-cases/reviews/SubmitReviewUseCase';
import type { InsertReviewInput, IReviewRepository, PublicReview } from '../../apps/api/src/application/ports/IReviewRepository';
import { REVIEWABLE_ORDER_STATUSES } from '../../apps/api/src/domain/reviews/ReviewDomain';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const PHONE = '+256700123456';

/** In-memory repository: one order with two lines, plus whatever reviews are inserted. */
function fakeRepo(orderStatus: string) {
  const inserted: InsertReviewInput[] = [];
  const lines: Record<string, { id: string; productId: string }> = { [P1]: { id: 'line-1', productId: P1 }, [P2]: { id: 'line-2', productId: P2 } };
  const repo: IReviewRepository = {
    async resolveOrderLine(id) { return Object.values(lines).some((l) => l.id === id) ? { orderPhone: PHONE, orderStatus } : null; },
    async insertReview(input) {
      if (inserted.some((r) => r.productId === input.productId && r.customerIdentityHash === input.customerIdentityHash)) return { conflict: true };
      inserted.push(input); return { id: `rev-${inserted.length}` };
    },
    async moderate() { return null; },
    async getAggregate(productId) { return productId === P1 ? { count: 2, sum: 9, average: 4.5, distribution: { '4': 1, '5': 1 } } : { count: 0, sum: 0, average: null, distribution: {} }; },
    async findOrderLineId(_on, productId) { return lines[productId]?.id ?? null; },
    async reviewedProductIds(hash, ids) { return new Set(inserted.filter((r) => r.customerIdentityHash === hash && ids.includes(r.productId)).map((r) => r.productId)); },
    async listPublished(productId): Promise<PublicReview[]> { return productId === P1 ? [{ id: 'r1', rating: 5, title: 'Fits well', body: 'Works in my Spark 4', isVerifiedPurchase: true, createdAt: new Date('2026-10-12') }] : []; },
  };
  return { repo, inserted };
}
const order = (orderStatus: string): VerifiedOrder => ({ orderNumber: 'GP-1001', customerPhone: PHONE, orderStatus, items: [{ productId: P1, name: 'Battery GP-39LT9' }, { productId: P2, name: 'Charger GP-C11' }, { productId: P1, name: 'Battery GP-39LT9' }] });
const build = (status: string) => {
  const { repo, inserted } = fakeRepo(status);
  return { inserted, submit: new SubmitOrderReviewUseCase(repo, new SubmitReviewUseCase(repo, 'pepper')), eligibility: new GetOrderReviewEligibilityUseCase(repo, 'pepper') };
};

describe('customer reviews', () => {
  it('a door delivery ends at "delivered", and that buyer is a verified purchase (it used to require "completed", which deliveries never reach)', async () => {
    expect(REVIEWABLE_ORDER_STATUSES.has('delivered')).toBe(true);
    for (const status of ['delivered', 'completed']) {
      const { submit, inserted } = build(status);
      expect(await submit.execute(order(status), { productId: P1, rating: 5, body: 'Fits my Spark 4' })).toMatchObject({ ok: true, status: 'pending' });
      expect(inserted[0]).toMatchObject({ orderItemId: 'line-1', isVerifiedPurchase: true, status: 'pending' });
    }
  });

  it('nothing can be rated before the order reaches the buyer', async () => {
    for (const status of ['received', 'processing', 'dispatched', 'cancelled', 'delivery_failed']) {
      const { submit, inserted } = build(status);
      expect(await submit.execute(order(status), { productId: P1, rating: 5 })).toEqual({ ok: false, reason: 'NOT_DELIVERED' });
      expect(inserted).toHaveLength(0);
    }
  });

  it('only items on this order, whole stars from one to five, and sane lengths', async () => {
    const { submit } = build('delivered');
    expect(await submit.execute(order('delivered'), { productId: '33333333-3333-4333-8333-333333333333', rating: 5 })).toEqual({ ok: false, reason: 'NOT_ON_ORDER' });
    for (const rating of [0, 6, 4.5, Number.NaN]) expect(await submit.execute(order('delivered'), { productId: P1, rating })).toEqual({ ok: false, reason: 'INVALID_RATING' });
    expect(await submit.execute(order('delivered'), { productId: P1, rating: 4, body: 'x'.repeat(2001) })).toEqual({ ok: false, reason: 'TOO_LONG' });
  });

  it('one review per buyer per product; eligibility lists each product once and marks what is done', async () => {
    const { submit, eligibility } = build('delivered');
    expect((await submit.execute(order('delivered'), { productId: P1, rating: 4 })).ok).toBe(true);
    expect(await submit.execute(order('delivered'), { productId: P1, rating: 5 })).toEqual({ ok: false, reason: 'ALREADY_REVIEWED' });
    expect(await eligibility.execute(order('delivered'))).toEqual({ delivered: true, items: [
      { productId: P1, name: 'Battery GP-39LT9', reviewed: true },
      { productId: P2, name: 'Charger GP-C11', reviewed: false },
    ] });
    expect((await eligibility.execute(order('processing'))).delivered).toBe(false);
  });

  it('a review that leaks a phone number is flagged for a moderator, never published', async () => {
    const { submit, inserted } = build('delivered');
    expect(await submit.execute(order('delivered'), { productId: P2, rating: 5, body: 'Call me on 0772 123 456' })).toMatchObject({ ok: true, status: 'flagged', flagged: true });
    expect(inserted[0].status).toBe('flagged');
  });

  it('product reviews: no aggregate until there is at least one published rating', async () => {
    const { repo } = fakeRepo('delivered');
    const uc = new GetProductReviewsUseCase(repo);
    expect((await uc.execute(P1)).aggregate).toMatchObject({ count: 2, average: 4.5 });
    expect(await uc.execute(P2)).toEqual({ aggregate: null, reviews: [] });
  });
});
