import { pgTable, uuid, varchar, text, integer, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * CMS pages with append-only revision history.
 *
 * cms_pages holds the live (current) version; every content edit bumps
 * current_version and appends a row to cms_page_revisions, so history
 * is never rewritten and any version can be reverted to (as a new version).
 */

export const cmsPages = pgTable('cms_pages', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: varchar('slug', { length: 80 }).unique().notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  body: text('body').notNull(), // markdown subset, rendered by the web app
  excerpt: varchar('excerpt', { length: 500 }),
  metaTitle: varchar('meta_title', { length: 70 }),
  metaDescription: varchar('meta_description', { length: 200 }),
  status: varchar('status', { length: 20 }).default('DRAFT').notNull(), // DRAFT | PUBLISHED | ARCHIVED
  publishAt: timestamp('publish_at', { withTimezone: true }),
  expireAt: timestamp('expire_at', { withTimezone: true }),
  currentVersion: integer('current_version').default(1).notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const cmsPageRevisions = pgTable(
  'cms_page_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => cmsPages.id, { onDelete: 'cascade' }).notNull(),
    version: integer('version').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    body: text('body').notNull(),
    excerpt: varchar('excerpt', { length: 500 }),
    metaTitle: varchar('meta_title', { length: 70 }),
    metaDescription: varchar('meta_description', { length: 200 }),
    editedBy: uuid('edited_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pageVersionUnique: uniqueIndex('cms_page_revisions_page_version_unique').on(table.pageId, table.version),
  }),
);

export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    provider: varchar('provider', { length: 20 }).notNull(), // e.g. google
    providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    providerIdentityUnique: uniqueIndex('user_identities_provider_unique').on(table.provider, table.providerUserId),
    userProviderUnique: uniqueIndex('user_identities_user_provider_unique').on(table.userId, table.provider),
    userIdx: index('user_identities_user_idx').on(table.userId),
  }),
);
