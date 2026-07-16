import { pgTable, text, timestamp, varchar, jsonb, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';

export const releaseReadinessRuns = pgTable('release_readiness_runs', {
  id: varchar('id', { length: 36 }).primaryKey().notNull(),
  status: varchar('status', { length: 50 }).notNull(), // PASS, FAIL, WARN, UNKNOWN
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  triggeredBy: uuid('triggered_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull()
});

export const releaseReadinessGateResults = pgTable('release_readiness_gate_results', {
  id: varchar('id', { length: 36 }).primaryKey().notNull(),
  runId: varchar('run_id', { length: 36 })
    .notNull()
    .references(() => releaseReadinessRuns.id, { onDelete: 'cascade' }),
  gateId: varchar('gate_id', { length: 100 }).notNull(),
  category: varchar('category', { length: 100 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(), // PASS, FAIL, WARN, NOT_CONFIGURED, NOT_APPLICABLE, BLOCKED, UNKNOWN
  severity: varchar('severity', { length: 50 }).notNull(), // CRITICAL, HIGH, MEDIUM, LOW
  evidence: jsonb('evidence').notNull().default('{}'), // Redacted evidence object
  source: varchar('source', { length: 255 }).notNull(),
  recommendation: text('recommendation'),
  safeReferenceId: varchar('safe_reference_id', { length: 255 }),
  checkedAt: timestamp('checked_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, mode: 'string' }),
  acknowledgedBy: uuid('acknowledged_by')
    .references(() => users.id),
  acknowledgementReason: text('acknowledgement_reason'),
});

export const releaseReadinessAuditLog = pgTable('release_readiness_audit_log', {
  id: varchar('id', { length: 36 }).primaryKey().notNull(),
  adminUserId: uuid('admin_user_id')
    .notNull()
    .references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 100 }),
  resourceId: varchar('resource_id', { length: 100 }),
  metadata: jsonb('metadata').default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const releaseDecisions = pgTable('release_decisions', {
  id: varchar('id', { length: 36 }).primaryKey().notNull(),
  runId: varchar('run_id', { length: 36 })
    .notNull()
    .references(() => releaseReadinessRuns.id),
  status: varchar('status', { length: 50 }).notNull(), // DRAFT, READY_FOR_REVIEW, APPROVED_FOR_CONTROLLED_ACTIVATION, BLOCKED, NEEDS_FIXES, NOT_READY
  recordedBy: uuid('recorded_by')
    .notNull()
    .references(() => users.id),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});
