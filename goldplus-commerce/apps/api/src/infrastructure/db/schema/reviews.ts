import { boolean, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, index, uuid, varchar } from 'drizzle-orm/pg-core';
import { orderItems } from './commerce';
import { products } from './products';

/**
 * U3 — product reviews, ratings and verified purchase.
 *
 * Verification is COMPUTED at submission (order_item_id resolves to a delivered
 * order for the same identity hash) and stored; it is never trusted from input.
 * The rating aggregate is maintained transactionally with publish/unpublish and
 * is never computed on read.
 */
export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id),
  orderItemId: uuid('order_item_id').references(() => orderItems.id), // null for unverified
  customerIdentityHash: varchar('customer_identity_hash', { length: 64 }).notNull(),
  rating: smallint('rating').notNull(),
  title: varchar('title', { length: 140 }),
  body: text('body'),
  isVerifiedPurchase: boolean('is_verified_purchase').notNull().default(false),
  status: varchar('status', { length: 12 }).notNull().default('pending'), // pending|published|rejected|flagged
  moderatedBy: uuid('moderated_by'),
  moderatedAt: timestamp('moderated_at', { withTimezone: true }),
  rejectionReason: varchar('rejection_reason', { length: 120 }),
  flagReason: varchar('flag_reason', { length: 120 }),
  helpfulCount: integer('helpful_count').notNull().default(0),
  language: varchar('language', { length: 8 }).notNull().default('en'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  productStatusIdx: index('reviews_product_status_created_idx').on(table.productId, table.status, table.createdAt),
  orderItemUq: uniqueIndex('reviews_order_item_uq').on(table.orderItemId), // one review per verified order line
  // One review per identity per product (verified or not) — enforced below in SQL
  // as a partial-safe unique on (product_id, customer_identity_hash).
  identityProductUq: uniqueIndex('reviews_identity_product_uq').on(table.productId, table.customerIdentityHash),
}));

export const reviewMedia = pgTable('review_media', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id').notNull().references(() => reviews.id),
  storageUrl: varchar('storage_url', { length: 500 }).notNull(),
  mediaType: varchar('media_type', { length: 24 }).notNull(),
  displayOrder: integer('display_order').notNull().default(0),
}, (table) => ({ reviewIdx: index('review_media_review_idx').on(table.reviewId, table.displayOrder) }));

export const reviewVotes = pgTable('review_votes', {
  reviewId: uuid('review_id').notNull().references(() => reviews.id),
  voterIdentityHash: varchar('voter_identity_hash', { length: 64 }).notNull(),
  vote: varchar('vote', { length: 12 }).notNull(), // helpful|not_helpful
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ pk: uniqueIndex('review_votes_pk').on(table.reviewId, table.voterIdentityHash) }));

export const productRatingAggregate = pgTable('product_rating_aggregate', {
  productId: uuid('product_id').primaryKey().references(() => products.id),
  ratingCount: integer('rating_count').notNull().default(0),
  ratingSum: integer('rating_sum').notNull().default(0),
  ratingAverage: numeric('rating_average', { precision: 3, scale: 2 }),
  distribution: jsonb('distribution').notNull().default({}),
  lastRecomputedAt: timestamp('last_recomputed_at', { withTimezone: true }),
});
