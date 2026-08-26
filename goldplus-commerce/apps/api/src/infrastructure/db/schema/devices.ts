import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { products } from './products';
import { mediaAssets } from './media';

/**
 * U2 — device catalogue, extended by 0125 into a brand → series → exact model
 * hierarchy. Distinct from product_compatibility_mappings (which is
 * product-to-product): this models real phone/device MODELS a customer owns, so
 * a battery can be matched to "Tecno Spark 7 (KF6n)" rather than to another SKU.
 *
 * No specification is ever invented. A field that cannot be sourced is null and
 * a compatibility claim stays at the evidence level it was given. Verified rows
 * carry an actor, an evidence source and a timestamp (0070 CHECK).
 */

export const deviceBrands = pgTable('device_brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 60 }).notNull(),
  nameNormalised: varchar('name_normalised', { length: 60 }).notNull(),
  slug: varchar('slug', { length: 80 }).notNull(),
  searchAliases: text('search_aliases').array().notNull().default([]),
  searchAliasesNormalised: text('search_aliases_normalised').array().notNull().default([]),
  logoAssetId: uuid('logo_asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
  isFeatured: boolean('is_featured').notNull().default(false),
  displayOrder: integer('display_order').notNull().default(0),
  status: text('status').notNull().default('ACTIVE'), // ACTIVE | ARCHIVED
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  slugIdx: uniqueIndex('device_brands_slug_idx').on(t.slug),
  nameIdx: uniqueIndex('device_brands_name_idx').on(t.nameNormalised),
  orderIdx: index('device_brands_order_idx').on(t.status, t.isFeatured, t.displayOrder),
}));

export const deviceSeries = pgTable('device_series', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id').notNull().references(() => deviceBrands.id),
  name: varchar('name', { length: 80 }).notNull(),
  nameNormalised: varchar('name_normalised', { length: 80 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull(),
  searchAliases: text('search_aliases').array().notNull().default([]),
  searchAliasesNormalised: text('search_aliases_normalised').array().notNull().default([]),
  displayOrder: integer('display_order').notNull().default(0),
  status: text('status').notNull().default('ACTIVE'), // ACTIVE | ARCHIVED
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  brandNameIdx: uniqueIndex('device_series_brand_name_idx').on(t.brandId, t.nameNormalised),
  brandSlugIdx: uniqueIndex('device_series_brand_slug_idx').on(t.brandId, t.slug),
  orderIdx: index('device_series_order_idx').on(t.brandId, t.status, t.displayOrder),
}));

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  brand: varchar('brand', { length: 60 }).notNull(),
  model: varchar('model', { length: 120 }).notNull(),
  // Original display strings are preserved; normalisation is stored separately
  // so lookups are case/spacing-insensitive without erasing what admins typed.
  brandNormalised: varchar('brand_normalised', { length: 60 }).notNull(),
  modelNormalised: varchar('model_normalised', { length: 120 }).notNull(),
  modelAliases: text('model_aliases').array().notNull().default([]),
  modelAliasesNormalised: text('model_aliases_normalised').array().notNull().default([]),
  slug: varchar('slug', { length: 160 }).notNull(),
  releaseYear: integer('release_year'),
  connectorType: varchar('connector_type', { length: 16 }), // usb_c | micro_usb | lightning | other
  chargingWattageMax: integer('charging_wattage_max'),
  screenDiagonalMm: integer('screen_diagonal_mm'),
  screenWidthMm: integer('screen_width_mm'),
  screenHeightMm: integer('screen_height_mm'),
  cameraCutoutType: varchar('camera_cutout_type', { length: 40 }),
  popularityRankUg: integer('popularity_rank_ug'),
  isActive: boolean('is_active').notNull().default(true),
  // 0125 — hierarchy and exact identity. `model` stays the marketing name;
  // `modelNumber` is the technical code (SM-A326B, KF6n, X695) and `variant` a
  // regional or carrier variant. Identity = brand + model + model number + variant.
  brandId: uuid('brand_id').references(() => deviceBrands.id),
  seriesId: uuid('series_id').references(() => deviceSeries.id),
  modelNumber: varchar('model_number', { length: 80 }),
  modelNumberNormalised: varchar('model_number_normalised', { length: 80 }),
  variant: varchar('variant', { length: 80 }),
  variantNormalised: varchar('variant_normalised', { length: 80 }),
  status: text('status').notNull().default('ACTIVE'), // ACTIVE | ARCHIVED | MERGED
  displayOrder: integer('display_order').notNull().default(0),
  mergedIntoDeviceId: uuid('merged_into_device_id'),
  sourceReference: varchar('source_reference', { length: 200 }),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  slugIdx: uniqueIndex('devices_slug_idx').on(table.slug),
  // NB: the identity index in migration 0125 is expression-based
  // (brand_normalised, model_normalised, COALESCE(model_number_normalised, ''),
  // COALESCE(variant_normalised, '')) and lives only in the migration.
  popularityIdx: index('devices_popularity_idx').on(table.popularityRankUg),
  brandSeriesIdx: index('devices_brand_series_idx').on(table.brandId, table.seriesId, table.status, table.displayOrder),
  modelNumberIdx: index('devices_model_number_idx').on(table.modelNumberNormalised),
}));

export const productDeviceCompatibility = pgTable('product_device_compatibility', {
  productId: uuid('product_id').notNull().references(() => products.id),
  deviceId: uuid('device_id').notNull().references(() => devices.id),
  fitType: varchar('fit_type', { length: 20 }).notNull(),      // exact | universal | adapter_required
  confidence: varchar('confidence', { length: 12 }).notNull(), // verified | inferred | declared
  verifiedBy: uuid('verified_by'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  evidenceSource: varchar('evidence_source', { length: 300 }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // 0125 — the compatibility workflow. The pair (product, device) stays the
  // primary key so a relationship can never be duplicated; `id` addresses it.
  id: uuid('id').notNull().defaultRandom(),
  // SUPPLIER_LISTED | PACKAGE_VERIFIED | FIT_TESTED | VERIFIED_EXACT | CONDITIONAL | REJECTED
  evidenceStatus: text('evidence_status').notNull().default('SUPPLIER_LISTED'),
  // DRAFT | REVIEW | READY | ACTIVE | ARCHIVED
  workflowStatus: text('workflow_status').notNull().default('DRAFT'),
  evidenceType: varchar('evidence_type', { length: 60 }),
  evidenceAssetId: uuid('evidence_asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
  publicCondition: varchar('public_condition', { length: 300 }),
  createdBy: uuid('created_by'),
  submittedBy: uuid('submitted_by'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: varchar('review_note', { length: 500 }),
  publishedBy: uuid('published_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  sourceImportSessionId: uuid('source_import_session_id'),
  sourceReference: varchar('source_reference', { length: 200 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: uniqueIndex('product_device_compat_pk').on(table.productId, table.deviceId),
  deviceIdx: index('product_device_compat_device_idx').on(table.deviceId),
  idIdx: uniqueIndex('product_device_compat_id_idx').on(table.id),
  workflowIdx: index('product_device_compat_workflow_idx').on(table.workflowStatus, table.evidenceStatus),
}));
