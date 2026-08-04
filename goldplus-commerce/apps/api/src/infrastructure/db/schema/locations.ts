import {
  pgTable,
  varchar,
  text,
  boolean,
  integer,
  bigint,
  uuid,
  timestamp,
  jsonb,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
/**
 * Location module reference + operational tables (location-module brief PARTs D–E).
 *
 * Reference data (ug_area / ug_area_alias / ug_data_exception) is loaded ONLY by
 * the MD5-gated import script from data/locations/v1 — never hand-inserted.
 * Postcode is deliberately NOT unique (14 codes are assigned twice in the
 * government source); the primary key is area_slug.
 *
 * delivery_zone_policy is the brief's `delivery_zone` (renamed: the repo already
 * has per-district `delivery_zones` owning FEES — decision #7/Option A keeps it
 * that way, and this table owns only non-fee policy: SLA, COD, carrier,
 * free-delivery threshold, plus a nullable fallback fee districts inherit).
 * Every policy value is seeded NULL; a zone cannot activate until ops fills
 * every required field. Nothing here defaults.
 */

export const ugArea = pgTable(
  'ug_area',
  {
    areaSlug: varchar('area_slug', { length: 160 }).primaryKey(),
    postcode: varchar('postcode', { length: 8 }), // NOT unique by design
    parishOrAreaClean: varchar('parish_or_area_clean', { length: 160 }).notNull(),
    parishOrAreaSource: varchar('parish_or_area_source', { length: 160 }),
    displayLabel: varchar('display_label', { length: 220 }).notNull(),
    currentDistrict: varchar('current_district', { length: 100 }).notNull(),
    district2019Source: varchar('district_2019_source', { length: 100 }),
    districtChanged: boolean('district_changed').default(false).notNull(),
    region: varchar('region', { length: 60 }),
    countyOrMunicipality: varchar('county_or_municipality', { length: 120 }),
    subcountyOrDivision: varchar('subcounty_or_division', { length: 120 }),
    deliveryZoneCode: varchar('delivery_zone_code', { length: 8 }),
    selectable: boolean('selectable').default(true).notNull(),
    isMetro: boolean('is_metro').default(false).notNull(),
    /** lowercase, unaccented, orthography-folded text the trigram index runs on */
    searchText: text('search_text').notNull(),
    dataVersion: integer('data_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    districtIdx: index('ug_area_district_idx').on(t.currentDistrict),
    zoneIdx: index('ug_area_zone_idx').on(t.deliveryZoneCode),
    postcodeIdx: index('ug_area_postcode_idx').on(t.postcode),
    // The GIN trigram index on search_text is raw SQL in the migration —
    // drizzle-kit 0.20 cannot express gin_trgm_ops.
  }),
);

export const ugAreaAlias = pgTable(
  'ug_area_alias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alias: varchar('alias', { length: 160 }).notNull(),
    /** lowercase folded form used for exact alias matching */
    normalisedAlias: varchar('normalised_alias', { length: 160 }).notNull(),
    areaSlug: varchar('area_slug', { length: 160 })
      .references(() => ugArea.areaSlug)
      .notNull(),
    confidence: varchar('confidence', { length: 20 }).notNull(), // e.g. exact | strong | approximate
    source: varchar('source', { length: 20 }).notNull(), // seeded | ops_promoted | imported
    note: varchar('note', { length: 300 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid('created_by'),
  },
  (t) => ({
    aliasAreaUnique: uniqueIndex('ug_area_alias_norm_area_idx').on(t.normalisedAlias, t.areaSlug),
    normIdx: index('ug_area_alias_norm_idx').on(t.normalisedAlias),
  }),
);

export const ugAreaGroup = pgTable(
  'ug_area_group',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupName: varchar('group_name', { length: 120 }).notNull(),
    normalisedName: varchar('normalised_name', { length: 120 }).notNull(),
    district: varchar('district', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    nameUnique: uniqueIndex('ug_area_group_name_idx').on(t.normalisedName, t.district),
  }),
);

export const ugAreaGroupMember = pgTable(
  'ug_area_group_member',
  {
    groupId: uuid('group_id')
      .references(() => ugAreaGroup.id)
      .notNull(),
    areaSlug: varchar('area_slug', { length: 160 })
      .references(() => ugArea.areaSlug)
      .notNull(),
  },
  (t) => ({
    pairUnique: uniqueIndex('ug_area_group_member_pair_idx').on(t.groupId, t.areaSlug),
  }),
);

export const ugDataException = pgTable('ug_data_exception', {
  id: uuid('id').primaryKey().defaultRandom(),
  exceptionType: varchar('exception_type', { length: 60 }).notNull(),
  district: varchar('district', { length: 100 }),
  postcode: varchar('postcode', { length: 8 }),
  areaRef: varchar('area_ref', { length: 160 }),
  description: text('description'),
  /** full source row, verbatim, for audit */
  sourceRow: jsonb('source_row'),
  dataVersion: integer('data_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ugLandmark = pgTable(
  'ug_landmark',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    areaSlug: varchar('area_slug', { length: 160 })
      .references(() => ugArea.areaSlug)
      .notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    landmarkType: varchar('landmark_type', { length: 30 }).notNull(), // stage|school|church|mosque|hospital|clinic|fuel_station|supermarket|shop|market|bank|hotel|bar_restaurant|office_building|roundabout|bridge|other
    usageCount: integer('usage_count').default(0).notNull(),
    verified: boolean('verified').default(false).notNull(),
    createdFromOrderId: uuid('created_from_order_id'),
    gpsLat: doublePrecision('gps_lat'),
    gpsLng: doublePrecision('gps_lng'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // uniqueness on (area_slug, lower(name)) is raw SQL in the migration —
    // expression indexes are beyond drizzle-kit 0.20.
    areaIdx: index('ug_landmark_area_idx').on(t.areaSlug),
  }),
);

export const ugPickupPoint = pgTable(
  'ug_pickup_point',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 160 }).notNull(),
    operator: varchar('operator', { length: 30 }).notNull(), // goldplus_shop|agent|bus_parcel_office|courier_branch|locker
    areaSlug: varchar('area_slug', { length: 160 }).references(() => ugArea.areaSlug),
    physicalAddress: text('physical_address'),
    landmarkText: text('landmark_text'),
    gpsLat: doublePrecision('gps_lat'),
    gpsLng: doublePrecision('gps_lng'),
    phone: varchar('phone', { length: 20 }),
    openingHours: jsonb('opening_hours'),
    servesDistricts: text('serves_districts').array(),
    active: boolean('active').default(false).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    areaIdx: index('ug_pickup_point_area_idx').on(t.areaSlug),
  }),
);

export const ugSearchMiss = pgTable(
  'ug_search_miss',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rawQuery: varchar('raw_query', { length: 200 }).notNull(),
    normalisedQuery: varchar('normalised_query', { length: 200 }).notNull(),
    sessionId: varchar('session_id', { length: 80 }),
    customerId: uuid('customer_id'),
    resultCount: integer('result_count').default(0).notNull(),
    resolvedAreaSlug: varchar('resolved_area_slug', { length: 160 }),
    resolvedVia: varchar('resolved_via', { length: 20 }), // alias|group|landmark|manual_entry|pickup_point|abandoned
    deviceHint: varchar('device_hint', { length: 120 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    normIdx: index('ug_search_miss_norm_idx').on(t.normalisedQuery),
    createdIdx: index('ug_search_miss_created_idx').on(t.createdAt),
  }),
);

export const deliveryZonePolicy = pgTable('delivery_zone_policy', {
  zoneCode: varchar('zone_code', { length: 8 }).primaryKey(), // Z1..Z4
  zoneName: varchar('zone_name', { length: 80 }).notNull(),
  slaHoursMin: integer('sla_hours_min'),
  slaHoursMax: integer('sla_hours_max'),
  /** Option A: fallback fee a district inherits when no finer price exists. NULL until Rob sets it. */
  fallbackFeeUgx: bigint('fallback_fee_ugx', { mode: 'number' }),
  freeDeliveryThresholdUgx: bigint('free_delivery_threshold_ugx', { mode: 'number' }),
  codAllowed: boolean('cod_allowed'),
  codMaxOrderValueUgx: bigint('cod_max_order_value_ugx', { mode: 'number' }),
  prepayRequiredAboveUgx: bigint('prepay_required_above_ugx', { mode: 'number' }),
  carrier: varchar('carrier', { length: 30 }), // own_rider|third_party_rider|bus_parcel|courier|pickup_only
  active: boolean('active').default(false).notNull(),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const addressAudit = pgTable(
  'address_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    addressId: uuid('address_id'),
    orderId: uuid('order_id'),
    actorType: varchar('actor_type', { length: 20 }).notNull(), // customer|ops|system
    actorId: uuid('actor_id'),
    action: varchar('action', { length: 40 }).notNull(), // created|edited|ops_resolved|status_changed|viewed_by_admin|soft_deleted|migration_linked
    before: jsonb('before'),
    after: jsonb('after'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    addressIdx: index('address_audit_address_idx').on(t.addressId),
    orderIdx: index('address_audit_order_idx').on(t.orderId),
  }),
);

