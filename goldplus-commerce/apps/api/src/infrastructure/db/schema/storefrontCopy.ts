import { boolean, integer, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Storefront copy (0115) — one validated JSONB document, singleton row (id pinned
 * true), edited atomically in /admin/storefront-copy. Same shape as business_info.
 */
export const storefrontCopy = pgTable('storefront_copy', {
  id: boolean('id').default(true).primaryKey(),
  config: jsonb('config').default({}).notNull(),
  version: integer('version').default(1).notNull(),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
