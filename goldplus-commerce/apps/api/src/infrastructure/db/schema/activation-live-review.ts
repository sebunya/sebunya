import { pgTable, text, timestamp, varchar, integer, jsonb, boolean } from 'drizzle-orm/pg-core';
import { controlledActivationExecutionPlans } from './activation-dry-run';
import { controlledActivationRequests } from './activation';

export const controlledActivationLiveReviewCandidates = pgTable('controlled_activation_live_review_candidates', {
  id: varchar('id', { length: 36 }).primaryKey(),
  activationRequestId: varchar('activation_request_id', { length: 36 }).notNull().references(() => controlledActivationRequests.id),
  executionPlanId: varchar('execution_plan_id', { length: 36 }).notNull().references(() => controlledActivationExecutionPlans.id),
  dryRunId: varchar('dry_run_id', { length: 36 }).notNull(),
  evidencePackId: varchar('evidence_pack_id', { length: 36 }).notNull(),
  createdByAdminId: varchar('created_by_admin_id', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(), // DRAFT, READY_FOR_REVIEW, BLOCKED, APPROVED_FOR_FUTURE_CONTROLLED_ACTIVATION, CANCELLED, EXPIRED
  environment: varchar('environment', { length: 50 }).notNull(),
  activationWindowStart: timestamp('activation_window_start').notNull(),
  activationWindowEnd: timestamp('activation_window_end').notNull(),
  canaryScopeSummary: text('canary_scope_summary').notNull(),
  monitoringOwner: varchar('monitoring_owner', { length: 255 }).notNull(),
  incidentOwner: varchar('incident_owner', { length: 255 }).notNull(),
  rollbackOwner: varchar('rollback_owner', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const controlledActivationLiveReadinessChecks = pgTable('controlled_activation_live_readiness_checks', {
  id: varchar('id', { length: 36 }).primaryKey(),
  candidateId: varchar('candidate_id', { length: 36 }).notNull().references(() => controlledActivationLiveReviewCandidates.id),
  gateId: varchar('gate_id', { length: 100 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(), // PASS, WARN, BLOCKED, NOT_CONFIGURED, CONSENT_BLOCKED, DRY_RUN_ONLY, EXPIRED, UNKNOWN
  severity: varchar('severity', { length: 20 }).notNull(), // CRITICAL, WARNING, INFO
  evidenceSummary: text('evidence_summary').notNull(),
  blockerReason: text('blocker_reason'),
  checkedAt: timestamp('checked_at').notNull().defaultNow(),
});

export const controlledActivationCanaryRunbooks = pgTable('controlled_activation_canary_runbooks', {
  id: varchar('id', { length: 36 }).primaryKey(),
  candidateId: varchar('candidate_id', { length: 36 }).notNull().references(() => controlledActivationLiveReviewCandidates.id),
  canaryScopeSummary: text('canary_scope_summary').notNull(),
  percentageCap: integer('percentage_cap').notNull(),
  maxAudienceSize: integer('max_audience_size').notNull(),
  includedSegments: jsonb('included_segments').notNull(), // string[]
  excludedSegments: jsonb('excluded_segments').notNull(), // string[]
  startCriteria: text('start_criteria').notNull(),
  pauseCriteria: text('pause_criteria').notNull(),
  rollbackCriteria: text('rollback_criteria').notNull(),
  successCriteria: text('success_criteria').notNull(),
  failureCriteria: text('failure_criteria').notNull(),
  monitoringCadence: text('monitoring_cadence').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const controlledActivationOperatorChecklists = pgTable('controlled_activation_operator_checklists', {
  id: varchar('id', { length: 36 }).primaryKey(),
  candidateId: varchar('candidate_id', { length: 36 }).notNull().references(() => controlledActivationLiveReviewCandidates.id),
  operatorAdminId: varchar('operator_admin_id', { length: 255 }).notNull(),
  checklistStatus: varchar('checklist_status', { length: 50 }).notNull(), // PENDING, COMPLETED
  items: jsonb('items').notNull(), // ChecklistItem[]
  acknowledgedAt: timestamp('acknowledged_at'),
});

export const controlledActivationStakeholderLiveApprovals = pgTable('controlled_activation_stakeholder_live_approvals', {
  id: varchar('id', { length: 36 }).primaryKey(),
  candidateId: varchar('candidate_id', { length: 36 }).notNull().references(() => controlledActivationLiveReviewCandidates.id),
  approverAdminId: varchar('approver_admin_id', { length: 255 }).notNull(),
  approvalStatus: varchar('approval_status', { length: 50 }).notNull(), // APPROVED, REJECTED, NEEDS_CHANGES
  approvalNote: text('approval_note').notNull(),
  approvedAt: timestamp('approved_at').notNull().defaultNow(),
});

export const controlledActivationIncidentPlans = pgTable('controlled_activation_incident_plans', {
  id: varchar('id', { length: 36 }).primaryKey(),
  candidateId: varchar('candidate_id', { length: 36 }).notNull().references(() => controlledActivationLiveReviewCandidates.id),
  incidentOwner: varchar('incident_owner', { length: 255 }).notNull(),
  escalationPath: text('escalation_path').notNull(),
  rollbackOwner: varchar('rollback_owner', { length: 255 }).notNull(),
  pauseCriteria: text('pause_criteria').notNull(),
  rollbackCriteria: text('rollback_criteria').notNull(),
  communicationPlan: text('communication_plan').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
