import { date, doublePrecision, index, integer, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { products } from './products';

/**
 * U6 — SEO infrastructure. `redirects` is the precondition for any URL
 * restructuring: a slug change auto-creates a 301 so the old URL never 404s.
 * `gsc_performance` is the Search Console warehouse (organic measurement), joined
 * to product and revenue. Live GSC ingestion uses real credentials (not fabricated).
 */
export const redirects = pgTable('redirects', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromPath: varchar('from_path', { length: 512 }).notNull(),
  toPath: varchar('to_path', { length: 512 }).notNull(),
  statusCode: integer('status_code').notNull().default(301),
  reason: varchar('reason', { length: 120 }),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  hitCount: integer('hit_count').notNull().default(0),
  lastHitAt: timestamp('last_hit_at', { withTimezone: true }),
}, (table) => ({ fromIdx: uniqueIndex('redirects_from_path_idx').on(table.fromPath) }));

export const gscPerformance = pgTable('gsc_performance', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  page: varchar('page', { length: 512 }).notNull(),
  query: varchar('query', { length: 300 }).notNull(),
  productId: uuid('product_id').references(() => products.id),
  clicks: integer('clicks').notNull().default(0),
  impressions: integer('impressions').notNull().default(0),
  position: doublePrecision('position'),
  ctr: doublePrecision('ctr'),
}, (table) => ({
  dateIdx: index('gsc_performance_date_idx').on(table.date),
  pageDateIdx: index('gsc_performance_page_date_idx').on(table.page, table.date),
  // One row per (date, page, query).
  uniqueIdx: uniqueIndex('gsc_performance_date_page_query_idx').on(table.date, table.page, table.query),
}));
