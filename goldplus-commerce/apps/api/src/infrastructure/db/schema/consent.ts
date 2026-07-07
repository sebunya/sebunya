import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  boolean,
  text,
  index,
} from 'drizzle-orm/pg-core';

/**
 * MEASUREMENT CONTROL TOWER — CONSENT RECORDS SCHEMA
 *
 * Stores the immutable audit trail of all consent decisions.
 * Every grant, update, and withdrawal is appended as a new row.
 * The most recent row for a given (fp_client_id, purpose) pair is
 * the authoritative consent state.
 *
 * Design: Append-only log pattern for GDPR Article 7(1) demonstration.
 */
export const consentRecords = pgTable('consent_records', {
  id: uuid('id').defaultRandom().primaryKey(),

  // Identity — one of fp_client_id or user_id must be present
  fpClientId: varchar('fp_client_id', { length: 255 }),
  userId:     uuid('user_id'),

  // The serialized consent decision for all purposes at the time of capture
  purposes: jsonb('purposes').notNull(), // ConsentState JSON

  // How this consent was collected
  grantType:      varchar('grant_type', { length: 30 }).notNull(),
  captureSurface: varchar('capture_surface', { length: 50 }).notNull(),
  noticeVersion:  varchar('notice_version', { length: 20 }).notNull(),
  consentLanguage: varchar('consent_language', { length: 10 }).notNull(),

  // Operator / privacy team metadata
  ipAddress:  varchar('ip_address', { length: 64 }),
  userAgent:  text('user_agent'),

  // Withdrawal tracking
  isWithdrawal: boolean('is_withdrawal').default(false).notNull(),
  withdrawnPurposes: jsonb('withdrawn_purposes'), // string[] of withdrawn purpose keys

  // Timestamps
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  fpClientIdx:    index('consent_fp_client_idx').on(table.fpClientId),
  userIdx:        index('consent_user_idx').on(table.userId),
  createdAtIdx:   index('consent_created_at_idx').on(table.createdAt),
}));

/**
 * MEASUREMENT CONTROL TOWER — CURRENT CONSENT STATE VIEW (materialized)
 *
 * A mutable row per identity that holds the latest resolved consent state.
 * Updated on every consent signal. Used by ConsentService for fast reads
 * without scanning the full append-only log.
 */
export const consentCurrentState = pgTable('consent_current_state', {
  id: uuid('id').defaultRandom().primaryKey(),

  // One of these must be non-null
  fpClientId: varchar('fp_client_id', { length: 255 }).unique(),
  userId:     uuid('user_id').unique(),

  // Resolved consent booleans (denormalized for fast lookup)
  analyticsGranted:       boolean('analytics_granted').default(false).notNull(),
  advertisingGranted:     boolean('advertising_granted').default(false).notNull(),
  personalizationGranted: boolean('personalization_granted').default(false).notNull(),
  // essential is always true, not stored

  // Audit reference
  lastGrantType:      varchar('last_grant_type', { length: 30 }).notNull().default('unknown'),
  lastNoticeVersion:  varchar('last_notice_version', { length: 20 }).notNull().default('v1.0'),
  lastConsentRecordId: uuid('last_consent_record_id'),

  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }), // null = never (for explicit grants)
}, (table) => ({
  fpClientUniqueIdx: index('consent_state_fp_client_idx').on(table.fpClientId),
  userUniqueIdx:     index('consent_state_user_idx').on(table.userId),
}));
