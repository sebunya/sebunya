import { pgTable, uuid, varchar, integer, timestamp, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { products } from './products';

/**
 * Slice 4: aggregated, anonymous search demand. One row per normalized query.
 * Deliberately contains no visitor, session, or contact identifiers —
 * telemetry stays separate from lead/contact capture (quote requests).
 */
export const searchDemandSignals = pgTable('search_demand_signals', {
  id: uuid('id').defaultRandom().primaryKey(),
  query: varchar('query', { length: 120 }).notNull(),
  searchCount: integer('search_count').notNull().default(0),
  zeroResultCount: integer('zero_result_count').notNull().default(0),
  lastResultCount: integer('last_result_count').notNull().default(0),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  firstSearchedAt: timestamp('first_searched_at', { withTimezone: true }).defaultNow().notNull(),
  lastSearchedAt: timestamp('last_searched_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  queryIdx: uniqueIndex('search_demand_query_idx').on(table.query),
  statusIdx: index('search_demand_status_idx').on(table.status),
}));

/** Aggregate-only query/product behavior. There is deliberately no actor/session/cart/order key. */
export const searchProductInsights = pgTable('search_product_insights', {
  id: uuid('id').defaultRandom().primaryKey(),
  query: varchar('query', { length: 120 }).references(() => searchDemandSignals.query, { onDelete: 'cascade' }).notNull(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
  impressionCount: integer('impression_count').default(0).notNull(),
  clickCount: integer('click_count').default(0).notNull(),
  conversionCount: integer('conversion_count').default(0).notNull(),
  rankSum: integer('rank_sum').default(0).notNull(),
  lastRank: integer('last_rank').notNull(),
  firstObservedAt: timestamp('first_observed_at', { withTimezone: true }).defaultNow().notNull(),
  lastObservedAt: timestamp('last_observed_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  queryProductIdx: uniqueIndex('search_product_insight_query_product_idx').on(table.query, table.productId),
  productIdx: index('search_product_insight_product_idx').on(table.productId),
  integrity: check('search_product_insight_integrity', sql`
    ${table.impressionCount} >= 0 and ${table.clickCount} >= 0 and ${table.conversionCount} >= 0
    and ${table.clickCount} <= ${table.impressionCount}
    and ${table.conversionCount} <= ${table.clickCount}
    and ${table.lastRank} between 1 and 50 and ${table.rankSum} >= ${table.impressionCount}
  `),
}));
