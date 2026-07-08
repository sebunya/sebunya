import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

/**
 * MEASUREMENT CONTROL TOWER — PREFERENCE PROFILE SCHEMA
 *
 * Stores customer communication channels, product interests,
 * and shopping intent. Tied 1:1 to a user_id.
 */
export const customerPreferences = pgTable('customer_preferences', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').unique().notNull(),

  // Communication channels (email, sms, whatsapp)
  channels: jsonb('channels').notNull(),
  
  // Topic preferences (deals, new_arrivals, etc)
  topics: jsonb('topics').notNull(),

  // Product categories of interest (power_banks, chargers, etc)
  interests: jsonb('interests').notNull(),

  // Shopping intent (buying_for_self, business, budget, etc)
  intent: jsonb('intent').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * MEASUREMENT CONTROL TOWER — PREFERENCE AUDIT SCHEMA
 *
 * Immutable append-only log of every time preferences are updated
 * to provide a clear history of choices, separate from consent records
 * which handle legal requirements for measurement/advertising.
 */
export const preferenceAuditLog = pgTable('preference_audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),

  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state').notNull(),

  source: varchar('source', { length: 50 }).notNull(),

  // No raw PII like emails or phone numbers stored in the audit payload.
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('pref_audit_user_idx').on(t.userId),
}));
