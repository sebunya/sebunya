import { pgTable, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { controlledActivationRequests } from './activation.js';
import { controlledActivationDryRuns } from './activation-dry-run.js';

export const controlledLiveCanaries = pgTable('controlled_live_canaries', {
  id: text('id').primaryKey(),
  dryRunId: text('dry_run_id').notNull().references(() => controlledActivationDryRuns.id),
  activationRequestId: text('activation_request_id').notNull().references(() => controlledActivationRequests.id),
  status: text('status').notNull(),
  canaryCap: integer('canary_cap').notNull(),
  destinationAllowlist: jsonb('destination_allowlist').notNull().$type<string[]>(),
  rollbackPlan: text('rollback_plan').notNull(),
  monitoringOwner: text('monitoring_owner').notNull(),
  rollbackReason: text('rollback_reason'),
  rollbackOwner: text('rollback_owner'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
});

export const controlledLiveCanaryDeliveryAttempts = pgTable('controlled_live_canary_delivery_attempts', {
  id: text('id').primaryKey(),
  canaryId: text('canary_id').notNull().references(() => controlledLiveCanaries.id),
  destination: text('destination').notNull(),
  status: text('status').notNull(),
  redactedPayloadSummary: text('redacted_payload_summary').notNull(),
  redactedResponseSummary: text('redacted_response_summary').notNull(),
  attemptedAt: timestamp('attempted_at').notNull().defaultNow()
});

export const controlledLiveCanaryEvidencePacks = pgTable('controlled_live_canary_evidence_packs', {
  id: text('id').primaryKey(),
  canaryId: text('canary_id').notNull().references(() => controlledLiveCanaries.id),
  eligibilitySummary: text('eligibility_summary').notNull(),
  deliveryAttemptSummary: text('delivery_attempt_summary').notNull(),
  consentSummary: text('consent_summary').notNull(),
  destinationSummary: text('destination_summary').notNull(),
  rollbackSummary: text('rollback_summary').notNull(),
  monitoringSummary: text('monitoring_summary').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
});

export const controlledLiveCanaryAuditLogs = pgTable('controlled_live_canary_audit_logs', {
  id: text('id').primaryKey(),
  canaryId: text('canary_id').notNull().references(() => controlledLiveCanaries.id),
  action: text('action').notNull(),
  actorAdminId: text('actor_admin_id').notNull(),
  reason: text('reason'),
  timestamp: timestamp('timestamp').notNull().defaultNow()
});
