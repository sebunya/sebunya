import { pgTable, uuid, varchar, text, integer, boolean, timestamp, jsonb, index, real } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Recommendation "control room" tables.
 *
 * - recommendation_surface_configs: admin-managed per-surface config
 *   (draft/published) with a versions table for publish/rollback.
 * - recommendation_merchandising_rules: pin/boost/bury/exclude.
 * - recommendation_compatibility_rules: powers "Complete Your Setup".
 * - recommendation_events: impression/click/add_to_cart/purchase for the
 *   analytics dashboard (first-party attribution).
 */

export const recommendationSurfaceConfigs = pgTable(
  'recommendation_surface_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    surface: varchar('surface', { length: 60 }).unique().notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('draft').notNull(), // draft | published
    title: varchar('title', { length: 120 }).notNull(),
    subtitle: varchar('subtitle', { length: 200 }),
    limit: integer('limit').default(8).notNull(),
    minItems: integer('min_items').default(1).notNull(),
    hideIfBelowMinItems: boolean('hide_if_below_min_items').default(true).notNull(),
    hideIfOnlyFallback: boolean('hide_if_only_fallback').default(false).notNull(),
    showReasonTags: boolean('show_reason_tags').default(true).notNull(),
    allowPageDuplicates: boolean('allow_page_duplicates').default(false).notNull(),
    fallbackTitle: varchar('fallback_title', { length: 120 }),
    fallbackChain: jsonb('fallback_chain').$type<string[]>().default([]).notNull(),
    signalWeights: jsonb('signal_weights').$type<Record<string, number>>().default({}).notNull(),
    maxPerCategory: integer('max_per_category'),
    maxPerBrand: integer('max_per_brand'),
    requiresPersonalization: boolean('requires_personalization').default(false).notNull(),
    version: integer('version').default(1).notNull(),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    enabledIdx: index('rec_surface_configs_enabled_idx').on(table.enabled, table.status),
  }),
);

export const recommendationConfigVersions = pgTable(
  'recommendation_config_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    surface: varchar('surface', { length: 60 }).notNull(),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    publishedBy: uuid('published_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    surfaceIdx: index('rec_config_versions_surface_idx').on(table.surface, table.version),
  }),
);

export const recommendationMerchandisingRules = pgTable(
  'recommendation_merchandising_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 150 }).notNull(),
    description: text('description'),
    enabled: boolean('enabled').default(true).notNull(),
    action: varchar('action', { length: 20 }).notNull(), // pin | boost | bury | exclude
    scope: varchar('scope', { length: 30 }).notNull(), // global | surface | category | product | anchor_product
    surface: varchar('surface', { length: 60 }),
    productId: uuid('product_id'),
    categoryId: uuid('category_id'),
    anchorProductId: uuid('anchor_product_id'),
    weight: real('weight'),
    priority: integer('priority').default(100).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    activeIdx: index('rec_merch_rules_active_idx').on(table.enabled, table.action, table.startsAt, table.endsAt),
    productIdx: index('rec_merch_rules_product_idx').on(table.productId),
    surfaceIdx: index('rec_merch_rules_surface_idx').on(table.surface),
  }),
);

export const recommendationCompatibilityRules = pgTable(
  'recommendation_compatibility_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    anchorProductId: uuid('anchor_product_id'),
    anchorCategoryId: uuid('anchor_category_id'),
    candidateProductId: uuid('candidate_product_id'),
    candidateCategoryId: uuid('candidate_category_id'),
    relationship: varchar('relationship', { length: 30 }).notNull(),
    confidence: real('confidence').default(1).notNull(),
    reasonText: varchar('reason_text', { length: 200 }),
    enabled: boolean('enabled').default(true).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    anchorProductIdx: index('rec_compat_anchor_product_idx').on(table.anchorProductId, table.enabled),
    anchorCategoryIdx: index('rec_compat_anchor_category_idx').on(table.anchorCategoryId, table.enabled),
  }),
);

export const recommendationEvents = pgTable(
  'recommendation_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventType: varchar('event_type', { length: 30 }).notNull(), // impression | click | add_to_cart | purchase
    surface: varchar('surface', { length: 60 }).notNull(),
    recommendationId: varchar('recommendation_id', { length: 100 }),
    algorithmVersion: varchar('algorithm_version', { length: 40 }),
    productId: varchar('product_id', { length: 100 }),
    anchorProductId: varchar('anchor_product_id', { length: 100 }),
    rank: integer('rank'),
    score: real('score'),
    reasonCode: varchar('reason_code', { length: 40 }),
    experimentKey: varchar('experiment_key', { length: 60 }),
    experimentVariant: varchar('experiment_variant', { length: 40 }),
    visitorId: varchar('visitor_id', { length: 100 }),
    userId: uuid('user_id'),
    sessionId: varchar('session_id', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    surfaceTypeIdx: index('rec_events_surface_type_idx').on(table.surface, table.eventType, table.createdAt),
    productIdx: index('rec_events_product_idx').on(table.productId, table.eventType),
  }),
);
