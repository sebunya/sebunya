import { pgTable, uuid, varchar, timestamp, boolean, jsonb, text, integer, index } from 'drizzle-orm/pg-core';

import { products } from './products';

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorId: uuid('actor_id'),
  action: varchar('action', { length: 100 }).notNull(),
  entity: varchar('entity', { length: 50 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  previousState: jsonb('previous_state'),
  newState: jsonb('new_state'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  payload: jsonb('payload').notNull(),
  isProcessed: boolean('is_processed').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  attemptCount: integer('attempt_count').default(0).notNull(),
  lastError: text('last_error'),
  // Lease ownership (migration 0054). Ownership is an explicit fact rather than
  // an inference from next_attempt_at, so completion can compare-and-set on it
  // and a worker that lost its lease writes nothing.
  workerId: varchar('worker_id', { length: 64 }),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  // Set when the event is dead-lettered. status = 'dead_letter' is the truthful
  // discriminator; is_processed stays true because the event IS finished.
  deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).unique(),
  channel: varchar('channel', { length: 50 }),
  template: varchar('template', { length: 100 }),
  status: varchar('status', { length: 30 }).default('pending').notNull(),
  relatedEntity: varchar('related_entity', { length: 50 }),
  relatedEntityId: uuid('related_entity_id'),
  dryRunOnly: boolean('dry_run_only').default(true).notNull(),
  previewOnly: boolean('preview_only').default(false).notNull(),
  noSendGuarantee: boolean('no_send_guarantee').default(false).notNull(),
  suppressedReason: text('suppressed_reason'),
}, (table) => ({
  eventTypeProcessedNextAttemptIdx: index('outbox_events_event_type_processed_next_attempt_idx').on(
    table.eventType,
    table.isProcessed,
    table.nextAttemptAt
  ),
  isProcessedIdx: index('outbox_events_is_processed_idx').on(table.isProcessed),
  nextAttemptIdx: index('outbox_events_next_attempt_at_idx').on(table.nextAttemptAt),
}));

export const verificationCodes = pgTable('verification_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  code: varchar('code', { length: 50 }).unique().notNull(),
  isUsed: boolean('is_used').default(false).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

export const verificationAttempts = pgTable('verification_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 50 }).notNull(),
  productId: uuid('product_id'),
  isSuccessful: boolean('is_successful').notNull(),
  ipAddress: varchar('ip_address', { length: 100 }),
  userAgent: text('user_agent'),
  /** 0085: optional signed-in attribution for verification-linked earning (loyalty PART J). */
  userId: uuid('user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

