import { boolean, integer, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Business / contact info (0112) — one validated JSONB document, singleton row
 * (id pinned true), edited atomically in /admin/business-info. Same shape as
 * nav_config.
 */
export const businessInfo = pgTable('business_info', {
  id: boolean('id').default(true).primaryKey(),
  config: jsonb('config').default({}).notNull(),
  version: integer('version').default(1).notNull(),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
