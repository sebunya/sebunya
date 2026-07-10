import { pgTable, text, timestamp, integer, boolean, jsonb } from 'drizzle-orm/pg-core';
import { controlledActivationRequests } from './activation';

export const controlledActivationExecutionPlans = pgTable('controlled_activation_execution_plans', {
  id: text('id').primaryKey(),
  activationRequestId: text('activation_request_id').notNull().references(() => controlledActivationRequests.id),
  createdByAdminId: text('created_by_admin_id').notNull(),
  status: text('status').notNull(),
  activationScope: text('activation_scope').notNull(),
  environment: text('environment').notNull(),
  requestedWindowStart: timestamp('requested_window_start'),
  requestedWindowEnd: timestamp('requested_window_end'),
  canaryScopeSummary: text('canary_scope_summary'),
  rollbackPlanSummary: text('rollback_plan_summary'),
  monitoringOwner: text('monitoring_owner'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
});

export const controlledActivationDryRuns = pgTable('controlled_activation_dry_runs', {
  id: text('id').primaryKey(),
  executionPlanId: text('execution_plan_id').notNull().references(() => controlledActivationExecutionPlans.id),
  activationRequestId: text('activation_request_id').notNull().references(() => controlledActivationRequests.id),
  startedByAdminId: text('started_by_admin_id').notNull(),
  status: text('status').notNull(),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  summary: text('summary'),
  blockerCount: integer('blocker_count').notNull().default(0),
  warningCount: integer('warning_count').notNull().default(0),
  redactedEvidenceRef: text('redacted_evidence_ref')
});

export const controlledActivationDestinationPreviews = pgTable('controlled_activation_destination_previews', {
  id: text('id').primaryKey(),
  dryRunId: text('dry_run_id').notNull().references(() => controlledActivationDryRuns.id),
  destination: text('destination').notNull(),
  eventType: text('event_type').notNull(),
  consentStatus: text('consent_status').notNull(),
  routingDecision: text('routing_decision').notNull(),
  status: text('status').notNull(),
  redactedPayload: jsonb('redacted_payload'),
  blockedReason: text('blocked_reason'),
  createdAt: timestamp('created_at').notNull().defaultNow()
});

export const controlledActivationCanaryPlans = pgTable('controlled_activation_canary_plans', {
  id: text('id').primaryKey(),
  executionPlanId: text('execution_plan_id').notNull().references(() => controlledActivationExecutionPlans.id),
  scopeSummary: text('scope_summary').notNull(),
  maxAudienceSize: integer('max_audience_size').notNull(),
  percentageCap: integer('percentage_cap').notNull(),
  includedSegments: jsonb('included_segments').notNull().$type<string[]>(),
  excludedSegments: jsonb('excluded_segments').notNull().$type<string[]>(),
  riskLevel: text('risk_level').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
});

export const controlledActivationEvidencePacks = pgTable('controlled_activation_evidence_packs', {
  id: text('id').primaryKey(),
  dryRunId: text('dry_run_id').notNull().references(() => controlledActivationDryRuns.id),
  activationRequestId: text('activation_request_id').notNull().references(() => controlledActivationRequests.id),
  summary: text('summary').notNull(),
  gateSummary: text('gate_summary').notNull(),
  payloadPreviewSummary: text('payload_preview_summary').notNull(),
  consentSummary: text('consent_summary').notNull(),
  canarySummary: text('canary_summary').notNull(),
  rollbackSummary: text('rollback_summary').notNull(),
  monitoringSummary: text('monitoring_summary').notNull(),
  redactedBy: text('redacted_by').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
});
