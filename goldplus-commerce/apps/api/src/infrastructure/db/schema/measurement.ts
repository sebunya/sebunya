import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  text,
  index,
  integer,
  real,
} from 'drizzle-orm/pg-core';

/**
 * MEASUREMENT CONTROL TOWER — ZERO-PARTY DATA SIGNALS TABLE
 *
 * Stores all zero-party data signals submitted by users.
 * Each row is immutable — updates are new rows.
 * Consent is pre-checked before insertion (personalization purpose required).
 */
export const zeroPartySignals = pgTable('zero_party_signals', {
  id: uuid('id').defaultRandom().primaryKey(),

  // Identity
  fpClientId: varchar('fp_client_id', { length: 255 }),
  userId:     uuid('user_id'),
  sessionId:  varchar('session_id', { length: 255 }),

  // Signal
  signalType:      varchar('signal_type', { length: 50 }).notNull(),
  payload:         jsonb('payload').notNull(),

  // Context
  pageLocation:    text('page_location'),
  productId:       varchar('product_id', { length: 255 }),
  sourceComponent: varchar('source_component', { length: 100 }),

  // Timestamps
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  fpClientIdx:  index('zero_party_fp_client_idx').on(table.fpClientId),
  userIdx:      index('zero_party_user_idx').on(table.userId),
  signalTypeIdx: index('zero_party_signal_type_idx').on(table.signalType),
}));

/**
 * MEASUREMENT CONTROL TOWER — ATTRIBUTION TOUCHPOINTS TABLE
 *
 * Records every measurable touchpoint in the customer journey.
 * Used by AttributionService to build multi-touch attribution models.
 *
 * The match_score is a 0–100 integer that measures the quality of
 * identity signal enrichment available for this touchpoint.
 */
export const attributionTouchpoints = pgTable('attribution_touchpoints', {
  id: uuid('id').defaultRandom().primaryKey(),

  // Identity
  fpClientId: varchar('fp_client_id', { length: 255 }),
  userId:     uuid('user_id'),
  orderId:    uuid('order_id'),

  // Event reference
  eventId:   varchar('event_id', { length: 255 }).notNull(),
  eventName: varchar('event_name', { length: 100 }).notNull(),

  // Attribution signals present at time of event
  hasHashedEmail: integer('has_hashed_email').default(0).notNull(), // 0 or 1
  hasHashedPhone: integer('has_hashed_phone').default(0).notNull(),
  hasFbp:         integer('has_fbp').default(0).notNull(),
  hasFbc:         integer('has_fbc').default(0).notNull(),
  hasGclid:       integer('has_gclid').default(0).notNull(),
  hasTtclid:      integer('has_ttclid').default(0).notNull(),
  hasLiFatId:     integer('has_li_fat_id').default(0).notNull(),
  hasIpAddress:   integer('has_ip_address').default(0).notNull(),
  hasUserAgent:   integer('has_user_agent').default(0).notNull(),

  // Computed match quality score (0–100)
  matchScore: real('match_score').default(0).notNull(),

  // Destination routing outcome
  routedDestinations: jsonb('routed_destinations'), // string[] — which CAPIs received this event
  blockedDestinations: jsonb('blocked_destinations'), // string[] — which CAPIs were consent-blocked

  // Timestamps
  eventTime:  timestamp('event_time', { withTimezone: true }).notNull(),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  fpClientIdx:   index('attribution_fp_client_idx').on(table.fpClientId),
  userIdx:       index('attribution_user_idx').on(table.userId),
  orderIdx:      index('attribution_order_idx').on(table.orderId),
  eventNameIdx:  index('attribution_event_name_idx').on(table.eventName),
  eventTimeIdx:  index('attribution_event_time_idx').on(table.eventTime),
}));
