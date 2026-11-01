import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { products } from './products';

/**
 * Catalogue intelligence (migration 0119): battery compatibility registry +
 * finder telemetry, storage-capacity test records, product lifecycle SEO.
 *
 * Evidence-first: a battery combination only reaches VERIFIED with an evidence
 * source (CHECK in the migration + use-case guard); a storage product with no
 * test row is honestly NOT_TESTED (never a default row); lifecycle decisions
 * record their evidence snapshot and REDIRECT dispositions require a
 * successor. CHECK constraints live in the hand-written migration; the
 * definitions below mirror it for the query builder.
 */

export const seoBatteryCompat = pgTable('seo_battery_compat', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneBrand: text('phone_brand').notNull(),
  phoneModel: text('phone_model').notNull(),
  modelNumber: text('model_number'),
  variant: text('variant'),
  batteryProductId: uuid('battery_product_id').references(() => products.id),
  batteryReference: text('battery_reference').notNull(),
  status: text('status').notNull().default('UNVERIFIED'),
  evidenceSource: text('evidence_source'),
  evidenceNote: text('evidence_note'),
  verifiedBy: uuid('verified_by'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // NB: the unique combination index in the migration is expression-based
  // (phone_brand, phone_model, COALESCE(variant, ''), battery_reference).
  statusIdx: index('seo_battery_compat_status_idx').on(t.status),
  productIdx: index('seo_battery_compat_product_idx').on(t.batteryProductId),
}));

export const seoBatteryFinderEvents = pgTable('seo_battery_finder_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  query: text('query').notNull(),
  phoneBrand: text('phone_brand'),
  phoneModel: text('phone_model'),
  matched: boolean('matched').notNull(),
  matchCount: integer('match_count').notNull().default(0),
  clickedProductId: uuid('clicked_product_id'),
}, (t) => ({
  occurredIdx: index('seo_battery_finder_events_occurred_idx').on(t.occurredAt),
  matchedIdx: index('seo_battery_finder_events_matched_idx').on(t.matched, t.occurredAt),
}));

export const seoStorageTests = pgTable('seo_storage_tests', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id),
  claimedCapacityGb: numeric('claimed_capacity_gb').notNull(),
  testedCapacityGb: numeric('tested_capacity_gb'),
  readMbS: numeric('read_mb_s'),
  writeMbS: numeric('write_mb_s'),
  method: text('method').notNull(),
  tool: text('tool'),
  tester: text('tester').notNull(),
  testedAt: date('tested_at').notNull(),
  result: text('result').notNull(),
  evidenceNote: text('evidence_note'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  productIdx: index('seo_storage_tests_product_idx').on(t.productId, t.testedAt),
}));

export const seoProductLifecycle = pgTable('seo_product_lifecycle', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id),
  state: text('state').notNull(),
  successorProductId: uuid('successor_product_id').references(() => products.id),
  disposition: text('disposition').notNull().default('UNDECIDED'),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  rationale: text('rationale'),
  evidence: jsonb('evidence'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  productIdx: uniqueIndex('seo_product_lifecycle_product_idx').on(t.productId),
  dispositionIdx: index('seo_product_lifecycle_disposition_idx').on(t.disposition),
}));
