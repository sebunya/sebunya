import { pgTable, uuid, varchar, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

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
