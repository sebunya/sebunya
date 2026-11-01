import { pgTable, uuid, varchar, integer, boolean, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Hero slider content (0107). The 12 campaign slides and the global settings,
 * lifted out of the markup so marketing can edit them without a deploy.
 *
 * `slideKey` is locked — the client engine keys eligibility and scoring off it.
 * `headline` may hold <em>…</em>; the sanitiser, not the column, is the XSS
 * boundary. `extras` carries per-campaign data only some slides have.
 */
export const heroSlides = pgTable('hero_slides', {
  id: uuid('id').defaultRandom().primaryKey(),
  slideKey: varchar('slide_key', { length: 24 }).notNull(),
  position: integer('position').default(0).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  theme: varchar('theme', { length: 12 }).notNull(),
  tint: varchar('tint', { length: 1 }).default('a').notNull(),
  media: varchar('media', { length: 8 }).default('stage').notNull(),
  kicker: varchar('kicker', { length: 48 }).default('').notNull(),
  headline: varchar('headline', { length: 200 }).default('').notNull(),
  subcopy: varchar('subcopy', { length: 240 }).default('').notNull(),
  ctaLabel: varchar('cta_label', { length: 48 }).default('').notNull(),
  ctaUrl: varchar('cta_url', { length: 512 }).default('').notNull(),
  finePrint: varchar('fine_print', { length: 160 }).default('').notNull(),
  imageUrl: varchar('image_url', { length: 512 }).default('').notNull(),
  imageAlt: varchar('image_alt', { length: 200 }).default('').notNull(),
  priority: integer('priority').default(0).notNull(),
  extras: jsonb('extras').default({}).notNull(),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  keyUq: uniqueIndex('hero_slides_key_uq').on(table.slideKey),
  orderIdx: index('hero_slides_order_idx').on(table.enabled, table.position),
}));

/** Single-row global settings (id pinned true). */
export const heroSettings = pgTable('hero_settings', {
  id: boolean('id').default(true).primaryKey(),
  slidesShown: integer('slides_shown').default(4).notNull(),
  dwellMs: integer('dwell_ms').default(6000).notNull(),
  autoplay: boolean('autoplay').default(true).notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Hero telemetry (0108): per-slide impressions and clicks, its own owner. */
export const heroEvents = pgTable('hero_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventType: varchar('event_type', { length: 12 }).notNull(),
  slideKey: varchar('slide_key', { length: 24 }).notNull(),
  position: integer('position').default(0).notNull(),
  segment: varchar('segment', { length: 16 }).default('unknown').notNull(),
  profileId: uuid('profile_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  slideIdx: index('hero_events_slide_idx').on(table.slideKey, table.eventType),
  createdIdx: index('hero_events_created_idx').on(table.createdAt),
}));
