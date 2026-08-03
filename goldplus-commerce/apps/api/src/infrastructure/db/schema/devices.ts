import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { products } from './products';

/**
 * U2 — device catalogue. Distinct from product_compatibility_mappings (which is
 * product-to-product): this models real phone/device MODELS a customer owns, so
 * an accessory can be matched to "Tecno Spark 20" rather than to another SKU.
 *
 * No specification is ever invented. A field that cannot be sourced is null and
 * compatibility confidence is 'declared', never 'verified'. Verified rows carry
 * an actor, an evidence source and a timestamp.
 */
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  slugIdx: uniqueIndex('devices_slug_idx').on(table.slug),
  brandModelIdx: uniqueIndex('devices_brand_model_idx').on(table.brandNormalised, table.modelNormalised),
  popularityIdx: index('devices_popularity_idx').on(table.popularityRankUg),
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
}, (table) => ({
  pk: uniqueIndex('product_device_compat_pk').on(table.productId, table.deviceId),
  deviceIdx: index('product_device_compat_device_idx').on(table.deviceId),
}));
