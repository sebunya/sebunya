import { customType, index, integer, jsonb, pgSchema, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * jsonb that lands as an OBJECT. drizzle 0.29 + postgres-js bind a JS object as
 * a JSON string, which PostgreSQL stores as a jsonb STRING (see commerce.ts,
 * jsonbStrict). Cast explicitly on the way in; readers still accept a string.
 */
const jsonbObject = customType<{ data: unknown; driverData: string }>({
  dataType() {
    return 'jsonb';
  },
  toDriver(value: unknown) {
    return sql`${JSON.stringify(value)}::jsonb` as unknown as string;
  },
});

/**
 * First-party data (0155, docs/first-party/README.md): identity conflicts,
 * rule-based customer segments, the reversible analysis exclusion of our own
 * traffic, consent evidence and the phone-hygiene change log.
 */

export const customerIdentityConflicts = pgTable('customer_identity_conflicts', {
  id: uuid('id').defaultRandom().primaryKey(),
  linkId: uuid('link_id'),
  signalType: varchar('signal_type', { length: 40 }).notNull(),
  identifierKey: varchar('identifier_key', { length: 128 }).notNull(),
  existingCanonicalId: uuid('existing_canonical_id').notNull(),
  proposedCanonicalId: uuid('proposed_canonical_id').notNull(),
  moment: varchar('moment', { length: 24 }),
  occurrences: integer('occurrences').default(1).notNull(),
  status: varchar('status', { length: 16 }).default('OPEN').notNull(),
  resolution: varchar('resolution', { length: 32 }),
  resolvedBy: varchar('resolved_by', { length: 80 }),
  resolutionReason: text('resolution_reason'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => ({
  openUq: uniqueIndex('customer_identity_conflicts_open_uq')
    .on(t.signalType, t.identifierKey, t.existingCanonicalId, t.proposedCanonicalId)
    .where(sql`${t.status} = 'OPEN'`),
  statusIdx: index('customer_identity_conflicts_status_idx').on(t.status, t.lastSeenAt),
}));

export const customerSegments = pgTable('customer_segments', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: varchar('key', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  definition: jsonbObject('definition').notNull(),
  definitionVersion: integer('definition_version').default(1).notNull(),
  status: varchar('status', { length: 16 }).default('ACTIVE').notNull(),
  /** NULL = never materialised. Never shown as 0. */
  memberCount: integer('member_count'),
  lastMaterialisedAt: timestamp('last_materialised_at', { withTimezone: true }),
  lastRunId: uuid('last_run_id'),
  createdBy: varchar('created_by', { length: 80 }).notNull(),
  updatedBy: varchar('updated_by', { length: 80 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const customerSegmentMembers = pgTable('customer_segment_members', {
  segmentId: uuid('segment_id').notNull().references(() => customerSegments.id),
  canonicalCustomerId: uuid('canonical_customer_id').notNull(),
  firstMatchedAt: timestamp('first_matched_at', { withTimezone: true }).defaultNow().notNull(),
  lastRunId: uuid('last_run_id').notNull(),
}, (t) => ({
  pk: primaryKey(t.segmentId, t.canonicalCustomerId),
  customerIdx: index('customer_segment_members_customer_idx').on(t.canonicalCustomerId),
}));

export const customerSegmentRuns = pgTable('customer_segment_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  trigger: varchar('trigger', { length: 24 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  customersEvaluated: integer('customers_evaluated'),
  segmentsEvaluated: integer('segments_evaluated'),
  ordersStitched: integer('orders_stitched'),
  stats: jsonbObject('stats').default({}).notNull(),
  error: text('error'),
});

export const analysisSchema = pgSchema('analysis');

export const trafficExclusionRuns = analysisSchema.table('traffic_exclusion_runs', {
  runId: uuid('run_id').primaryKey(),
  mode: varchar('mode', { length: 12 }).notNull(),
  rules: jsonbObject('rules').default([]).notNull(),
  windowFrom: timestamp('window_from', { withTimezone: true }),
  windowTo: timestamp('window_to', { withTimezone: true }),
  marked: integer('marked').default(0).notNull(),
  reverted: integer('reverted').default(0).notNull(),
  actor: varchar('actor', { length: 80 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  notes: text('notes'),
});

export const trafficExclusionMarks = analysisSchema.table('traffic_exclusion_marks', {
  sourceTable: varchar('source_table', { length: 40 }).notNull(),
  rowId: uuid('row_id').notNull(),
  ruleKey: varchar('rule_key', { length: 40 }).notNull(),
  runId: uuid('run_id').notNull(),
  markedAt: timestamp('marked_at', { withTimezone: true }).defaultNow().notNull(),
  revertedAt: timestamp('reverted_at', { withTimezone: true }),
  revertedRunId: uuid('reverted_run_id'),
}, (t) => ({
  pk: primaryKey(t.sourceTable, t.rowId),
}));

export const consentEventEvidence = pgTable('consent_event_evidence', {
  consentEventId: uuid('consent_event_id').primaryKey(),
  purposeKey: varchar('purpose_key', { length: 100 }).notNull(),
  channelKey: varchar('channel_key', { length: 50 }).notNull(),
  endpointHash: varchar('endpoint_hash', { length: 64 }),
  endpointMasked: varchar('endpoint_masked', { length: 32 }),
  copyVersionId: varchar('copy_version_id', { length: 100 }).notNull(),
  copyTextHash: varchar('copy_text_hash', { length: 64 }).notNull(),
  confirmation: varchar('confirmation', { length: 40 }).notNull(),
  ipHash: varchar('ip_hash', { length: 64 }),
  userAgentHash: varchar('user_agent_hash', { length: 64 }),
  sourceSurface: varchar('source_surface', { length: 100 }).notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
});

export const phoneNormalisationLog = pgTable('phone_normalisation_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id').notNull(),
  tableName: varchar('table_name', { length: 40 }).notNull(),
  columnName: varchar('column_name', { length: 40 }).notNull(),
  rowId: uuid('row_id').notNull(),
  previousValue: varchar('previous_value', { length: 50 }).notNull(),
  newValue: varchar('new_value', { length: 20 }).notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow().notNull(),
  revertedAt: timestamp('reverted_at', { withTimezone: true }),
});

/** 0157: a customer's own data requests (export, anonymise history, delete account). */
export const privacyRequests = pgTable('privacy_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  reference: varchar('reference', { length: 16 }).notNull().unique(),
  userId: uuid('user_id').notNull(),
  kind: varchar('kind', { length: 24 }).notNull(),
  status: varchar('status', { length: 16 }).default('RECEIVED').notNull(),
  customerNote: text('customer_note'),
  idempotencyKey: varchar('idempotency_key', { length: 80 }).unique(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionReason: text('decision_reason'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  /** Counts only, never personal data. */
  result: jsonbObject('result').default({}).notNull(),
}, (t) => ({
  statusIdx: index('privacy_requests_status_idx').on(t.status, t.requestedAt),
  userIdx: index('privacy_requests_user_idx').on(t.userId, t.requestedAt),
}));

/**
 * 0157: browser ids tied to a customer ONLY so a stored refusal on that browser
 * is honoured. Never read for profiling or personalisation.
 */
export const customerConsentAnchors = pgTable('customer_consent_anchors', {
  canonicalCustomerId: uuid('canonical_customer_id').notNull(),
  fpClientId: varchar('fp_client_id', { length: 120 }).notNull(),
  reason: varchar('reason', { length: 40 }).notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey(t.canonicalCustomerId, t.fpClientId),
  fpIdx: index('customer_consent_anchors_fp_idx').on(t.fpClientId),
}));
