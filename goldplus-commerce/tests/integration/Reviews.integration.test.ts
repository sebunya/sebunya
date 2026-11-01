import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleReviewRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzleReviewRepository';
import { SubmitReviewUseCase } from '../../apps/api/src/application/use-cases/reviews/SubmitReviewUseCase';
import { computeRatingAggregate } from '../../apps/api/src/domain/reviews/ReviewDomain';
import { hashCustomerPhoneIdentity } from '../../apps/api/src/domain/pricing/CustomerIdentity';
import { GetOrderReviewEligibilityUseCase, GetProductReviewsUseCase, SubmitOrderReviewUseCase } from '../../apps/api/src/application/use-cases/reviews/OrderReviewUseCases';

/**
 * U3 — reviews on real PostgreSQL.
 *   AC1 a review for an order line owned by a different customer is rejected.
 *   AC2 the aggregate is exactly consistent with published reviews after 100
 *       randomised publish/unpublish operations.
 *   AC5 a review containing a phone/email is flagged and does not auto-publish.
 *   + verified-purchase computation, one-review-per-identity at the DB boundary.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;
const PEPPER = 'test-identity-pepper-thirty-two-chars-000000';

suite('reviews (real PostgreSQL, U3)', () => {
  let raw: any;
  const repo = new DrizzleReviewRepository();
  const submit = new SubmitReviewUseCase(repo, PEPPER);
  let categoryId: string;
  const productIds: string[] = [];
  const orderIds: string[] = [];

  const mkProduct = async (): Promise<string> => {
    const s = `rv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 40);
    const [p] = await raw`insert into products (sku, model_number, name, slug, category_id) values (${s}, ${s}, ${s}, ${s}, ${categoryId}) returning id`;
    productIds.push(p.id);
    return p.id;
  };
  const mkOrderWithItem = async (phone: string, status: string, productId: string): Promise<string> => {
    const on = `rvo${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`.slice(0, 20);
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status)
      values (${on}, 'T', ${phone}, 'Kla', 'Adr', 100, 0, 100, ${status}, 'paid') returning id`;
    orderIds.push(o.id);
    const [oi] = await raw`insert into order_items (order_id, product_id, sku, product_name, quantity, unit_price) values (${o.id}, ${productId}, 'SKU', 'Item', 1, 100) returning id`;
    return oi.id;
  };

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 6, prepare: false });
    const s = `rvcat-${Date.now()}`;
    const [cat] = await raw`insert into categories (name, slug) values (${s}, ${s}) returning id`;
    categoryId = cat.id;
  });

  afterAll(async () => {
    if (!raw) return;
    if (productIds.length) {
      await raw`delete from product_rating_aggregate where product_id = any(${productIds})`;
      await raw`delete from reviews where product_id = any(${productIds})`;
    }
    if (orderIds.length) {
      await raw`delete from order_items where order_id = any(${orderIds})`;
      await raw`delete from orders where id = any(${orderIds})`;
    }
    if (productIds.length) await raw`delete from products where id = any(${productIds})`;
    await raw`delete from categories where id = ${categoryId}`;
    await raw.end();
  });

  it('AC1: rejects a review for an order line owned by a different customer', async () => {
    const product = await mkProduct();
    const orderItem = await mkOrderWithItem('+256700111222', 'completed', product);
    const wrong = await submit.execute({ productId: product, orderItemId: orderItem, customerPhone: '+256700999000', rating: 5 });
    expect(wrong).toEqual({ ok: false, reason: 'ORDER_NOT_OWNED' });
  });

  it('computes verified purchase for the owning customer of a delivered order', async () => {
    const product = await mkProduct();
    // 'delivered' is where a door delivery ENDS (OrderStateMachine); this test used 'completed' and hid that delivered buyers were never verified.
    const orderItem = await mkOrderWithItem('+256700333444', 'delivered', product);
    const ok = await submit.execute({ productId: product, orderItemId: orderItem, customerPhone: '+256 700-333-444', rating: 4, body: 'solid' });
    expect(ok.ok && ok.isVerifiedPurchase).toBe(true);
  });

  it('enforces one review per identity per product', async () => {
    const product = await mkProduct();
    const first = await submit.execute({ productId: product, customerPhone: '+256700555666', rating: 5 });
    expect(first.ok).toBe(true);
    const second = await submit.execute({ productId: product, customerPhone: '+256 700 555 666', rating: 1 });
    expect(second).toEqual({ ok: false, reason: 'ALREADY_REVIEWED' });
  });

  it('AC5: flags a review that leaks a phone number and does not auto-publish', async () => {
    const product = await mkProduct();
    const result = await submit.execute({ productId: product, customerPhone: '+256700777888', rating: 5, body: 'great, whatsapp me on 0779998887' });
    expect(result.ok && result.flagged).toBe(true);
    expect(result.ok && result.status).toBe('flagged');
    const [row] = await raw`select status from reviews where product_id = ${product}`;
    expect(row.status).toBe('flagged'); // never 'published'
  });

  it('AC2: the aggregate stays exactly consistent across 100 randomised publish/unpublish operations', async () => {
    const product = await mkProduct();
    // Seed 8 pending reviews with distinct identities and varied ratings.
    const reviewIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const hash = hashCustomerPhoneIdentity(`+2567000000${i}${i}`, PEPPER);
      const rating = (i % 5) + 1;
      const [r] = await raw`insert into reviews (product_id, customer_identity_hash, rating, status) values (${product}, ${hash}, ${rating}, 'pending') returning id`;
      reviewIds.push(r.id);
    }
    const statuses = ['published', 'pending', 'rejected'] as const;
    for (let i = 0; i < 100; i++) {
      const reviewId = reviewIds[Math.floor(Math.random() * reviewIds.length)];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      await repo.moderate({ reviewId, status, moderatorId: '00000000-0000-4000-8000-000000000000', reason: null, now: new Date() });
    }
    // The stored aggregate must match a fresh recompute from the published rows.
    const published = await raw`select rating from reviews where product_id = ${product} and status = 'published'`;
    const expected = computeRatingAggregate(published.map((r: any) => r.rating));
    const actual = await repo.getAggregate(product);
    expect(actual).not.toBeNull();
    expect(actual!.count).toBe(expected.count);
    expect(actual!.sum).toBe(expected.sum);
    expect(actual!.average).toBe(expected.average);
    expect(actual!.distribution).toEqual(expected.distribution);
  }, 30_000);

  it('the customer flow end to end on real SQL: eligibility, submit, already-reviewed, moderation, public read', async () => {
    const product = await mkProduct();
    const phone = '+256700555666';
    const on = `rvf${Date.now().toString(36)}`.slice(0, 20);
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status)
      values (${on}, 'T', ${phone}, 'Kla', 'Adr', 100, 0, 100, 'delivered', 'paid') returning id`;
    orderIds.push(o.id);
    await raw`insert into order_items (order_id, product_id, sku, product_name, quantity, unit_price) values (${o.id}, ${product}, 'SKU', 'Item', 1, 100)`;
    const order = { orderNumber: on, customerPhone: phone, orderStatus: 'delivered', items: [{ productId: product, name: 'Item' }] };

    const eligibility = new GetOrderReviewEligibilityUseCase(repo, PEPPER);
    const submitOrder = new SubmitOrderReviewUseCase(repo, submit);
    const read = new GetProductReviewsUseCase(repo);

    expect(await eligibility.execute(order)).toEqual({ delivered: true, items: [{ productId: product, name: 'Item', reviewed: false }] });
    expect(await submitOrder.execute(order, { productId: product, rating: 5, title: 'Fits', body: 'Works well' })).toMatchObject({ ok: true, status: 'pending' });
    expect((await eligibility.execute(order)).items[0].reviewed).toBe(true);
    expect(await submitOrder.execute(order, { productId: product, rating: 4 })).toEqual({ ok: false, reason: 'ALREADY_REVIEWED' });

    // Pending reviews are invisible to shoppers; publishing makes them public and builds the aggregate.
    expect(await read.execute(product)).toEqual({ aggregate: null, reviews: [] });
    const [row] = await raw`select id, is_verified_purchase from reviews where product_id = ${product}`;
    // The moderation queue shows the moderator WHICH product and the full text.
    const queued = (await repo.listByStatus('pending')).find((r) => r.id === row.id);
    expect(queued).toMatchObject({ productId: product, title: 'Fits', body: 'Works well' });
    expect(queued?.productName).toBeTruthy();
    expect(queued?.productSlug).toBeTruthy();
    expect(row.is_verified_purchase).toBe(true);
    await repo.moderate({ reviewId: row.id, status: 'published', moderatorId: '00000000-0000-4000-8000-000000000000', reason: null, now: new Date() });
    const after = await read.execute(product);
    expect(after.aggregate).toMatchObject({ count: 1, average: 5 });
    expect(after.reviews).toEqual([expect.objectContaining({ rating: 5, title: 'Fits', body: 'Works well', isVerifiedPurchase: true })]);
  });
});
