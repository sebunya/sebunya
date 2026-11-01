import { boolean, integer, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Homepage marketing content (0114) — one validated JSONB document, singleton row
 * (id pinned true), edited atomically in /admin/homepage. Same shape as
 * business_info.
 */
export const homepageContent = pgTable('homepage_content', {
  id: boolean('id').default(true).primaryKey(),
  config: jsonb('config').default({}).notNull(),
  version: integer('version').default(1).notNull(),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
