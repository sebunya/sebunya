import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  boolean,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Delivery estimation schema (brief v7, migration 0092).
 *
 * This is the data the ONE quoting service reads. Nothing here computes a fee.
 * Every configuration value ships NULL or neutral: a factor at 1.0 means
 * "nothing learned yet", and the six launch values are absent until Rob sets
 * them, at which point the module stops returning `fee_unavailable`.
 */

export const deliveryOrigin = pgTable('delivery_origin', {
  originCode: varchar('origin_code', { length: 40 }).primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  role: varchar('role', { length: 40 }).notNull(),
  street: varchar('street', { length: 160 }),
  landmarkPrimary: varchar('landmark_primary', { length: 160 }),
  landmarkSecondary: varchar('landmark_secondary', { length: 160 }),
  areaSlug: varchar('area_slug', { length: 160 }),
  district: varchar('district', { length: 100 }),
  corridor: varchar('corridor', { length: 40 }),
  distanceBand: varchar('distance_band', { length: 4 }),
  /** numeric, not float — 32.57750 must round-trip exactly. */
  latitude: numeric('latitude', { precision: 9, scale: 6 }).notNull(),
  longitude: numeric('longitude', { precision: 9, scale: 6 }).notNull(),
  coordSource: varchar('coord_source', { length: 60 }),
  coordAnchor: varchar('coord_anchor', { length: 300 }),
  coordConfidence: varchar('coord_confidence', { length: 60 }),
  active: boolean('active').default(false).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ activeIdx: index('delivery_origin_active_idx').on(t.active) }));

export const deliveryCorridor = pgTable('delivery_corridor', {
  areaSlug: varchar('area_slug', { length: 160 }).primaryKey(),
  postcode: varchar('postcode', { length: 8 }),
  deliveryZone: varchar('delivery_zone', { length: 4 }),
  district: varchar('district', { length: 100 }).notNull(),
  subCountyOrDivision: varchar('sub_county_or_division', { length: 160 }),
  area: varchar('area', { length: 160 }).notNull(),
  /** NOT NULL by design: PART 9 #9 — no metro area without a corridor and band. */
  corridor: varchar('corridor', { length: 40 }).notNull(),
  distanceBand: varchar('distance_band', { length: 4 }).notNull(),
  accessMode: varchar('access_mode', { length: 16 }).notNull(),
  assignmentConfidence: varchar('assignment_confidence', { length: 16 }),
  assignmentBasis: varchar('assignment_basis', { length: 24 }),
  serviceable: boolean('serviceable').default(true).notNull(),
  centroidLat: numeric('centroid_lat', { precision: 9, scale: 6 }),
  centroidLng: numeric('centroid_lng', { precision: 9, scale: 6 }),
  centroidSource: varchar('centroid_source', { length: 24 }),
  centroidSampleSize: integer('centroid_sample_size').default(0).notNull(),
  dataVersion: integer('data_version').default(1).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  corridorIdx: index('delivery_corridor_corridor_idx').on(t.corridor),
  bandIdx: index('delivery_corridor_band_idx').on(t.distanceBand),
}));

export const deliveryAliasCorridor = pgTable('delivery_alias_corridor', {
  alias: varchar('alias', { length: 120 }).primaryKey(),
  aliasType: varchar('alias_type', { length: 40 }).notNull(),
  district: varchar('district', { length: 100 }).notNull(),
  anchorAreaInGazetteer: varchar('anchor_area_in_gazetteer', { length: 160 }),
  anchorPostcode: varchar('anchor_postcode', { length: 8 }),
  anchorAreaSlug: varchar('anchor_area_slug', { length: 160 }).notNull(),
  corridor: varchar('corridor', { length: 40 }).notNull(),
  distanceBand: varchar('distance_band', { length: 4 }).notNull(),
  bandConfidence: varchar('band_confidence', { length: 16 }),
  /** 5 of 28 differ from their anchor — this table is not derivable. */
  differsFromAnchor: boolean('differs_from_anchor').default(false).notNull(),
  note: text('note'),
  dataVersion: integer('data_version').default(1).notNull(),
});

export const deliveryNameCollision = pgTable('delivery_name_collision', {
  id: uuid('id').defaultRandom().primaryKey(),
  collisionType: varchar('collision_type', { length: 48 }).notNull(),
  collidingName: varchar('colliding_name', { length: 160 }).notNull(),
  districtWithThatName: varchar('district_with_that_name', { length: 100 }),
  areaSitsInDistrict: varchar('area_sits_in_district', { length: 100 }).notNull(),
  subCounty: varchar('sub_county', { length: 160 }),
  postcode: varchar('postcode', { length: 8 }),
  areaSlug: varchar('area_slug', { length: 160 }).notNull(),
  deliveryZone: varchar('delivery_zone', { length: 4 }),
  routingRule: text('routing_rule'),
  dataVersion: integer('data_version').default(1).notNull(),
}, (t) => ({
  uq: uniqueIndex('delivery_name_collision_uq').on(t.collisionType, t.collidingName, t.areaSlug),
}));

export const deliveryConfigVersion = pgTable('delivery_config_version', {
  id: uuid('id').defaultRandom().primaryKey(),
  status: varchar('status', { length: 12 }).default('draft').notNull(),
  reason: varchar('reason', { length: 500 }),
  createdBy: uuid('created_by'),
  publishedBy: uuid('published_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  /** Compared in EAT by the reader — see packages/shared/src/time/eat.ts. */
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  revertedFrom: uuid('reverted_from'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ statusIdx: index('delivery_config_version_status_idx').on(t.status) }));

export const deliveryConfigValue = pgTable('delivery_config_value', {
  id: uuid('id').defaultRandom().primaryKey(),
  versionId: uuid('version_id').references(() => deliveryConfigVersion.id, { onDelete: 'cascade' }).notNull(),
  configKey: varchar('config_key', { length: 80 }).notNull(),
  configValue: text('config_value'),
  /** Whether a human set this number or the nightly model proposed it. */
  origin: varchar('origin', { length: 16 }).default('human').notNull(),
  sampleSize: integer('sample_size'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ uq: uniqueIndex('delivery_config_value_uq').on(t.versionId, t.configKey) }));

export const deliveryLearnedFactor = pgTable('delivery_learned_factor', {
  id: uuid('id').defaultRandom().primaryKey(),
  factorKind: varchar('factor_kind', { length: 24 }).notNull(),
  scopeKey: varchar('scope_key', { length: 160 }).notNull(),
  /** 1.0 = nothing learned yet, and admin must show it as such. */
  value: numeric('value', { precision: 8, scale: 4 }).default('1.0').notNull(),
  sampleSize: integer('sample_size').default(0).notNull(),
  origin: varchar('origin', { length: 16 }).default('prior').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ uq: uniqueIndex('delivery_learned_factor_uq').on(t.factorKind, t.scopeKey) }));

export const deliveryQuoteCapture = pgTable('delivery_quote_capture', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull(),
  areaSlug: varchar('area_slug', { length: 160 }),
  aliasUsed: varchar('alias_used', { length: 120 }),
  corridor: varchar('corridor', { length: 40 }),
  distanceBand: varchar('distance_band', { length: 4 }),
  quotedFeeUgx: bigint('quoted_fee_ugx', { mode: 'number' }),
  finalFeeUgx: bigint('final_fee_ugx', { mode: 'number' }),
  varianceReason: varchar('variance_reason', { length: 48 }),
  /** Moved into stage A: without this from the first delivery, PART 4 is dead. */
  actualRiderCostUgx: bigint('actual_rider_cost_ugx', { mode: 'number' }),
  expectedMinutes: numeric('expected_minutes', { precision: 8, scale: 2 }),
  actualMinutes: numeric('actual_minutes', { precision: 8, scale: 2 }),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  hadPin: boolean('had_pin'),
  firstAttemptSuccess: boolean('first_attempt_success'),
  distanceTravelledKm: numeric('distance_travelled_km', { precision: 8, scale: 2 }),
  centroidSource: varchar('centroid_source', { length: 24 }),
  configVersionId: uuid('config_version_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  orderUq: uniqueIndex('delivery_quote_capture_order_uq').on(t.orderId),
  areaIdx: index('delivery_quote_capture_area_idx').on(t.areaSlug),
  deliveredIdx: index('delivery_quote_capture_delivered_idx').on(t.deliveredAt),
}));
