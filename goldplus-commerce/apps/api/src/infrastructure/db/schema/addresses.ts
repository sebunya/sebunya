import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  doublePrecision,
  real,
  integer,
} from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Customer delivery addresses.
 *
 * Extended by the location module (migration 0084) into the brief's
 * `customer_address` shape — additively, keeping the original name and columns:
 *  - `user_id` became nullable so guest checkout can persist an address record
 *  - the structured area link (`area_slug` / `area_group_id`) is nullable: the
 *    manual PART H path saves with `area_slug` NULL + `raw_address_text` set +
 *    `resolution_status = 'needs_ops_review'`
 *  - snapshots freeze the gazetteer meaning at save time so a later data
 *    version can never silently rewrite a historical order's destination
 *  - rows are soft-deleted (`deleted_at`) — orders reference them historically.
 */
export const addresses = pgTable('addresses', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 50 }).notNull(),
  recipientName: varchar('recipient_name', { length: 100 }).notNull(),
  phone: varchar('phone', { length: 20 }).notNull(),
  district: varchar('district', { length: 100 }).notNull(),
  areaDetails: text('area_details').notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  // ── location module (0084) ──────────────────────────────────────────────
  areaSlug: varchar('area_slug', { length: 160 }),
  areaGroupId: uuid('area_group_id'),
  landmarkText: text('landmark_text'),
  additionalDirections: text('additional_directions'),
  phoneSecondary: varchar('phone_secondary', { length: 20 }),
  gpsLat: doublePrecision('gps_lat'),
  gpsLng: doublePrecision('gps_lng'),
  gpsAccuracyM: real('gps_accuracy_m'),
  gpsSource: varchar('gps_source', { length: 20 }), // device|pasted_link|ops_entered
  gpsCapturedAt: timestamp('gps_captured_at', { withTimezone: true }),
  rawAddressText: text('raw_address_text'),
  resolutionStatus: varchar('resolution_status', { length: 20 }).default('resolved').notNull(), // resolved|needs_ops_review|ops_confirmed|undeliverable
  deliveryMethod: varchar('delivery_method', { length: 20 }).default('door').notNull(), // door|pickup_point
  pickupPointId: uuid('pickup_point_id'),
  snapshotAreaLabel: varchar('snapshot_area_label', { length: 220 }),
  snapshotDistrict: varchar('snapshot_district', { length: 100 }),
  snapshotPostcode: varchar('snapshot_postcode', { length: 8 }),
  snapshotDataVersion: integer('snapshot_data_version'),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
