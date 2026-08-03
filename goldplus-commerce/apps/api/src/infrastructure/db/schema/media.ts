import { pgTable, uuid, varchar, timestamp, integer, bigint, index, uniqueIndex, doublePrecision } from 'drizzle-orm/pg-core';

/**
 * Media library (Wave 2B DAM).
 *
 * `media_assets` is the canonical asset record — ONE row per distinct file, keyed by
 * content checksum so re-uploading the same bytes never duplicates storage. The
 * pre-existing `product_images` gallery keeps working unchanged; new uploads link a
 * gallery row to its library asset via `product_images.asset_id` (added in 0076).
 * Deletion is safe-by-construction: an asset with usage rows refuses to delete.
 */

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    filename: varchar('filename', { length: 300 }).notNull(),
    mime: varchar('mime', { length: 100 }).notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    // Nullable: dimensions come from the variant generator; when it is unavailable
    // the original is still stored and dimensions stay honestly unknown.
    width: integer('width'),
    height: integer('height'),
    checksum: varchar('checksum_sha256', { length: 64 }).notNull(),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    url: varchar('url', { length: 600 }).notNull(),
    altText: varchar('alt_text', { length: 255 }),
    caption: varchar('caption', { length: 500 }),
    rights: varchar('rights', { length: 300 }),
    rightsExpiresAt: timestamp('rights_expires_at', { withTimezone: true }),
    focalX: doublePrecision('focal_x'),
    focalY: doublePrecision('focal_y'),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(), // ACTIVE | ARCHIVED
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    checksumUq: uniqueIndex('media_assets_checksum_uq').on(t.checksum),
    statusIdx: index('media_assets_status_idx').on(t.status),
    createdIdx: index('media_assets_created_idx').on(t.createdAt),
  }),
);

export const mediaAssetVariants = pgTable(
  'media_asset_variants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assetId: uuid('asset_id').references(() => mediaAssets.id, { onDelete: 'cascade' }).notNull(),
    purpose: varchar('purpose', { length: 30 }).notNull(), // thumb | card | pdp | zoom
    format: varchar('format', { length: 10 }).notNull(), // avif | webp | jpeg
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    url: varchar('url', { length: 600 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    assetIdx: index('media_asset_variants_asset_idx').on(t.assetId),
    purposeUq: uniqueIndex('media_asset_variants_purpose_uq').on(t.assetId, t.purpose, t.format),
  }),
);

export const mediaUsages = pgTable(
  'media_usages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assetId: uuid('asset_id').references(() => mediaAssets.id, { onDelete: 'cascade' }).notNull(),
    entity: varchar('entity', { length: 50 }).notNull(), // product | category | campaign | creator | review | legal | homepage
    entityId: uuid('entity_id').notNull(),
    field: varchar('field', { length: 50 }).notNull(), // e.g. primary_image | gallery
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    assetIdx: index('media_usages_asset_idx').on(t.assetId),
    entityIdx: index('media_usages_entity_idx').on(t.entity, t.entityId),
    usageUq: uniqueIndex('media_usages_uq').on(t.assetId, t.entity, t.entityId, t.field),
  }),
);
