import { pgTable, uuid, varchar, timestamp, integer, boolean, jsonb, index, uniqueIndex, doublePrecision } from 'drizzle-orm/pg-core';

/**
 * Commerce Analytics operator configuration (migration 0061).
 *
 * Saved views and alert rules are governed configuration, not user preferences:
 * both carry an explicit owner and both are audited when created, changed or
 * removed. Alert rules deliberately have no destination column — evaluation
 * raises an internal analytics action and can never become an outbound message
 * path without a new migration and a new review.
 */

export const analyticsSavedViews = pgTable('analytics_saved_views', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  description: varchar('description', { length: 500 }),
  /** PRIVATE: owner only. SHARED: any holder of analytics.read. */
  scope: varchar('scope', { length: 16 }).default('PRIVATE').notNull(),
  periodDays: integer('period_days'),
  startDay: varchar('start_day', { length: 10 }),
  endDay: varchar('end_day', { length: 10 }),
  metricKeys: jsonb('metric_keys').default([]).notNull(),
  filters: jsonb('filters').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ownerNameIdx: uniqueIndex('analytics_saved_views_owner_name_idx').on(table.ownerId, table.name),
  scopeIdx: index('analytics_saved_views_scope_idx').on(table.scope),
}));

export const analyticsAlertRules = pgTable('analytics_alert_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  metricKey: varchar('metric_key', { length: 80 }).notNull(),
  comparison: varchar('comparison', { length: 16 }).notNull(),
  threshold: doublePrecision('threshold').notNull(),
  /** Mandatory volume floor: a rule cannot fire on one low-volume event. */
  minimumSample: integer('minimum_sample').notNull(),
  evaluationDays: integer('evaluation_days').default(7).notNull(),
  severity: varchar('severity', { length: 16 }).default('MEDIUM').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  cooldownMinutes: integer('cooldown_minutes').default(720).notNull(),
  lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }),
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ownerNameIdx: uniqueIndex('analytics_alert_rules_owner_name_idx').on(table.ownerId, table.name),
  enabledIdx: index('analytics_alert_rules_enabled_idx').on(table.enabled, table.metricKey),
}));
