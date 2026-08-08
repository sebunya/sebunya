import { boolean, integer, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Product discovery taxonomy (0113) — one validated JSONB document (a JSON array
 * of categories), singleton row (id pinned true), edited atomically in
 * /admin/categories. Same shape as nav_config / business_info.
 */
export const taxonomyConfig = pgTable('taxonomy_config', {
  id: boolean('id').default(true).primaryKey(),
  config: jsonb('config').default([]).notNull(),
  version: integer('version').default(1).notNull(),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
