import { pgTable, uuid, varchar, timestamp, integer, text } from 'drizzle-orm/pg-core';
import { products } from './products';

export const campaigns = pgTable('campaigns', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  objective: varchar('objective', { length: 50 }).notNull(),
  channel: varchar('channel', { length: 50 }).notNull(),
  status: varchar('status', { length: 30 }).default('DRAFT').notNull(),
  readinessScore: integer('readiness_score').default(0).notNull(),
  targetUrl: varchar('target_url', { length: 500 }),
});

export const utmLinks = pgTable('utm_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id').references(() => campaigns.id).notNull(),
  source: varchar('utm_source', { length: 100 }).notNull(),
  medium: varchar('utm_medium', { length: 100 }).notNull(),
  campaignName: varchar('utm_campaign', { length: 100 }).notNull(),
  content: varchar('utm_content', { length: 100 }),
  term: varchar('utm_term', { length: 100 }),
  shortUrl: varchar('short_url', { length: 100 }).unique(),
});

export const productFeeds = pgTable('product_feeds', {
  id: uuid('id').defaultRandom().primaryKey(),
  feedType: varchar('feed_type', { length: 50 }).notNull(),
  status: varchar('status', { length: 30 }).default('DRAFT').notNull(),
  lastGeneratedAt: timestamp('last_generated_at', { withTimezone: true }),
});

export const productFeedItems = pgTable('product_feed_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  feedId: uuid('feed_id').references(() => productFeeds.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  eligibilityStatus: varchar('eligibility_status', { length: 30 }).notNull(),
  exclusionReason: text('exclusion_reason'),
});
