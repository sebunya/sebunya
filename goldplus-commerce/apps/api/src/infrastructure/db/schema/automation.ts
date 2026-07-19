import { pgTable, uuid, varchar, integer, boolean, jsonb, timestamp, text, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Automation control plane — governed definitions with immutable versions,
 * version-scoped approvals, restart-safe executions and per-action executions
 * (outbox-backed), suppression reasons and an audit event timeline. Reuses the
 * existing outbox/notification/consent/audit systems; creates no second engine.
 */

export const automationDefinitions = pgTable(
  'automation_definitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 24 }).default('DRAFT').notNull(),
    currentVersion: integer('current_version').default(0).notNull(),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ statusIdx: index('automation_definitions_status_idx').on(t.status), nextRunIdx: index('automation_definitions_next_run_idx').on(t.nextRunAt) })
);

export const automationVersions = pgTable(
  'automation_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    definitionId: uuid('definition_id').references(() => automationDefinitions.id).notNull(),
    versionNumber: integer('version_number').notNull(),
    config: jsonb('config').notNull(),
    requiresApproval: boolean('requires_approval').default(false).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ defVersionIdx: uniqueIndex('automation_versions_def_version_idx').on(t.definitionId, t.versionNumber) })
);

export const automationApprovals = pgTable(
  'automation_approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    definitionId: uuid('definition_id').references(() => automationDefinitions.id).notNull(),
    versionId: uuid('version_id').references(() => automationVersions.id).notNull(),
    status: varchar('status', { length: 16 }).default('PENDING').notNull(),
    approverId: uuid('approver_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ versionIdx: index('automation_approvals_version_idx').on(t.versionId) })
);

export const automationExecutions = pgTable(
  'automation_executions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    definitionId: uuid('definition_id').references(() => automationDefinitions.id).notNull(),
    versionId: uuid('version_id').references(() => automationVersions.id).notNull(),
    versionNumber: integer('version_number').notNull(),
    triggerExecutionKey: varchar('trigger_execution_key', { length: 240 }).notNull(),
    triggerFamily: varchar('trigger_family', { length: 32 }).notNull(),
    triggerEventId: varchar('trigger_event_id', { length: 128 }),
    subjectId: varchar('subject_id', { length: 128 }),
    windowKey: varchar('window_key', { length: 40 }).notNull(),
    status: varchar('status', { length: 20 }).default('PLANNED').notNull(),
    plannedCount: integer('planned_count').default(0).notNull(),
    ineligibleCount: integer('ineligible_count').default(0).notNull(),
    evidence: jsonb('evidence'),
    // Lease fields for restart-safe claiming (FOR UPDATE SKIP LOCKED + expiry).
    leaseOwner: varchar('lease_owner', { length: 64 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    attempt: integer('attempt').default(0).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    error: text('error'),
    plannedAt: timestamp('planned_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    triggerKeyIdx: uniqueIndex('automation_executions_trigger_key_idx').on(t.triggerExecutionKey),
    statusIdx: index('automation_executions_status_idx').on(t.status),
    subjectWindowIdx: index('automation_executions_subject_window_idx').on(t.subjectId, t.windowKey),
  })
);

export const automationActionExecutions = pgTable(
  'automation_action_executions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    executionId: uuid('execution_id').references(() => automationExecutions.id).notNull(),
    actionIndex: integer('action_index').notNull(),
    actionFamily: varchar('action_family', { length: 32 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 260 }).notNull(),
    status: varchar('status', { length: 20 }).default('PLANNED').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    lastError: text('last_error'),
    outboxEventId: uuid('outbox_event_id'),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    replayedAt: timestamp('replayed_at', { withTimezone: true }),
    replayActor: uuid('replay_actor'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idemIdx: uniqueIndex('automation_action_executions_idem_idx').on(t.idempotencyKey),
    executionIdx: index('automation_action_executions_execution_idx').on(t.executionId),
    statusRetryIdx: index('automation_action_executions_status_retry_idx').on(t.status, t.nextRetryAt),
    deadLetterIdx: index('automation_action_executions_dead_letter_idx').on(t.deadLetteredAt),
  })
);

export const automationSuppressions = pgTable(
  'automation_suppressions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    executionId: uuid('execution_id').references(() => automationExecutions.id).notNull(),
    actionExecutionId: uuid('action_execution_id').references(() => automationActionExecutions.id),
    subjectId: varchar('subject_id', { length: 128 }),
    reason: varchar('reason', { length: 40 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ executionIdx: index('automation_suppressions_execution_idx').on(t.executionId), reasonIdx: index('automation_suppressions_reason_idx').on(t.reason) })
);

/** Durable cap slots. One execution owns at most one slot; retries/replay reuse it. */
export const automationFrequencyCapReservations = pgTable(
  'automation_frequency_cap_reservations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    executionId: uuid('execution_id').references(() => automationExecutions.id).notNull(),
    definitionId: uuid('definition_id').references(() => automationDefinitions.id).notNull(),
    versionId: uuid('version_id').references(() => automationVersions.id).notNull(),
    subjectScope: varchar('subject_scope', { length: 140 }).notNull(),
    windowKey: varchar('window_key', { length: 40 }).notNull(),
    limitSnapshot: integer('limit_snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    executionIdx: uniqueIndex('automation_frequency_cap_reservations_execution_idx').on(t.executionId),
    scopeWindowIdx: index('automation_frequency_cap_reservations_scope_window_idx').on(t.versionId, t.subjectScope, t.windowKey),
  })
);

export const automationEvents = pgTable(
  'automation_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    definitionId: uuid('definition_id').references(() => automationDefinitions.id),
    versionId: uuid('version_id'),
    executionId: uuid('execution_id'),
    eventType: varchar('event_type', { length: 40 }).notNull(),
    actorId: uuid('actor_id'),
    fromState: varchar('from_state', { length: 24 }),
    toState: varchar('to_state', { length: 24 }),
    reason: text('reason'),
    correlationId: varchar('correlation_id', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ definitionIdx: index('automation_events_definition_idx').on(t.definitionId), executionIdx: index('automation_events_execution_idx').on(t.executionId) })
);
