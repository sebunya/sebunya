import { pgTable, uuid, varchar, integer, boolean, jsonb, timestamp, text, index, uniqueIndex, doublePrecision } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Decision Intelligence — versioned policies, evidence-backed insights, evidence
 * snapshots, recommendations, assignment history and an audit event timeline.
 * A projection/analysis layer over authoritative systems; it creates no second
 * reporting engine, customer profile, NBA engine, ledger or outbox.
 */

export const decisionPolicies = pgTable(
  'decision_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    signalType: varchar('signal_type', { length: 48 }).notNull(),
    category: varchar('category', { length: 20 }).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    config: jsonb('config').notNull(),
    policyVersion: integer('policy_version').notNull(),
    calculationVersion: integer('calculation_version').notNull(),
    effectiveDate: varchar('effective_date', { length: 20 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ signalIdx: uniqueIndex('decision_policies_signal_version_idx').on(t.signalType, t.policyVersion) })
);

export const decisionInsights = pgTable(
  'decision_insights',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    idempotencyKey: varchar('idempotency_key', { length: 240 }).notNull(),
    category: varchar('category', { length: 20 }).notNull(),
    signalType: varchar('signal_type', { length: 48 }).notNull(),
    subject: varchar('subject', { length: 120 }).notNull(),
    subjectRef: varchar('subject_ref', { length: 128 }),
    windowKey: varchar('window_key', { length: 40 }).notNull(),
    severity: varchar('severity', { length: 12 }).notNull(),
    confidence: varchar('confidence', { length: 24 }).notNull(),
    status: varchar('status', { length: 16 }).default('OPEN').notNull(),
    recommendation: varchar('recommendation', { length: 40 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    summary: text('summary').notNull(),
    score: doublePrecision('score').notNull(),
    currentValue: doublePrecision('current_value').notNull(),
    baselineValue: doublePrecision('baseline_value').notNull(),
    delta: doublePrecision('delta').notNull(),
    sampleSize: integer('sample_size').notNull(),
    freshestAt: timestamp('freshest_at', { withTimezone: true }),
    policyVersion: integer('policy_version').notNull(),
    calculationVersion: integer('calculation_version').notNull(),
    sourceVersion: integer('source_version').notNull(),
    version: integer('version').default(1).notNull(),
    assignedTo: uuid('assigned_to').references(() => users.id),
    assignedTeam: varchar('assigned_team', { length: 64 }),
    resolutionCode: varchar('resolution_code', { length: 32 }),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    keyIdx: uniqueIndex('decision_insights_key_idx').on(t.idempotencyKey),
    statusIdx: index('decision_insights_status_idx').on(t.status),
    categoryIdx: index('decision_insights_category_idx').on(t.category),
    severityIdx: index('decision_insights_severity_idx').on(t.severity),
    assignedIdx: index('decision_insights_assigned_idx').on(t.assignedTo),
  })
);

export const decisionEvidence = pgTable(
  'decision_evidence',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    insightId: uuid('insight_id').references(() => decisionInsights.id).notNull(),
    metric: varchar('metric', { length: 40 }).notNull(),
    baseline: doublePrecision('baseline').notNull(),
    currentValue: doublePrecision('current_value').notNull(),
    delta: doublePrecision('delta').notNull(),
    currentWindowDays: integer('current_window_days').notNull(),
    comparisonWindowDays: integer('comparison_window_days').notNull(),
    sampleSize: integer('sample_size').notNull(),
    freshestAt: timestamp('freshest_at', { withTimezone: true }),
    sourceType: varchar('source_type', { length: 48 }).notNull(),
    sourceRef: varchar('source_ref', { length: 128 }).notNull(),
    sourceVersion: integer('source_version').notNull(),
    policyVersion: integer('policy_version').notNull(),
    calculationVersion: integer('calculation_version').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ insightIdx: index('decision_evidence_insight_idx').on(t.insightId) })
);

export const decisionRecommendations = pgTable(
  'decision_recommendations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    insightId: uuid('insight_id').references(() => decisionInsights.id).notNull(),
    recommendationType: varchar('recommendation_type', { length: 40 }).notNull(),
    handoffState: varchar('handoff_state', { length: 24 }),
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ insightIdx: index('decision_recommendations_insight_idx').on(t.insightId) })
);

export const decisionAssignments = pgTable(
  'decision_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    insightId: uuid('insight_id').references(() => decisionInsights.id).notNull(),
    assignedTo: uuid('assigned_to').references(() => users.id),
    assignedTeam: varchar('assigned_team', { length: 64 }),
    assignedBy: uuid('assigned_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ insightIdx: index('decision_assignments_insight_idx').on(t.insightId) })
);

export const decisionEvents = pgTable(
  'decision_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    insightId: uuid('insight_id').references(() => decisionInsights.id).notNull(),
    eventType: varchar('event_type', { length: 40 }).notNull(),
    actorId: uuid('actor_id'),
    fromStatus: varchar('from_status', { length: 16 }),
    toStatus: varchar('to_status', { length: 16 }),
    reason: text('reason'),
    correlationId: varchar('correlation_id', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ insightIdx: index('decision_events_insight_idx').on(t.insightId) })
);
