import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

export const fraudCases = pgTable('fraud_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  referenceKey: varchar('reference_key', { length: 160 }).notNull(),
  sourceType: varchar('source_type', { length: 20 }).notNull(),
  sourceRef: varchar('source_ref', { length: 160 }).notNull(),
  subjectRefHash: varchar('subject_ref_hash', { length: 64 }),
  status: varchar('status', { length: 20 }).notNull().default('OPEN'),
  priority: varchar('priority', { length: 20 }).notNull().default('LOW'),
  assignedTo: uuid('assigned_to'),
  version: integer('version').notNull().default(1),
  finalDecision: varchar('final_decision', { length: 20 }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  referenceIdx: uniqueIndex('fraud_cases_reference_idx').on(table.referenceKey),
  queueIdx: index('fraud_cases_queue_idx').on(table.status, table.priority, table.createdAt),
  assigneeIdx: index('fraud_cases_assignee_idx').on(table.assignedTo, table.status),
}));

export const fraudSignals = pgTable('fraud_signals', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').notNull().references(() => fraudCases.id),
  signalKey: varchar('signal_key', { length: 160 }).notNull(),
  signalType: varchar('signal_type', { length: 80 }).notNull(),
  severity: varchar('severity', { length: 20 }).notNull(),
  reasonCode: varchar('reason_code', { length: 80 }).notNull(),
  evidence: jsonb('evidence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  signalIdx: uniqueIndex('fraud_signals_case_key_idx').on(table.caseId, table.signalKey),
  caseIdx: index('fraud_signals_case_idx').on(table.caseId, table.createdAt),
}));

export const fraudCaseEvents = pgTable('fraud_case_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').notNull().references(() => fraudCases.id),
  action: varchar('action', { length: 40 }).notNull(),
  actorId: uuid('actor_id'),
  reason: text('reason').notNull(),
  evidence: jsonb('evidence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ caseIdx: index('fraud_case_events_case_idx').on(table.caseId, table.createdAt) }));
