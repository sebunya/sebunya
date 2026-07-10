import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const controlledActivationRequests = pgTable('controlled_activation_requests', {
  id: text('id').primaryKey(),
  requestedByAdminId: text('requested_by_admin_id').notNull(),
  requestedAt: timestamp('requested_at').notNull(),
  activationName: text('activation_name').notNull(),
  activationScope: text('activation_scope').notNull(),
  environment: text('environment').notNull(),
  requestedWindowStart: timestamp('requested_window_start'),
  requestedWindowEnd: timestamp('requested_window_end'),
  status: text('status').notNull(),
  reason: text('reason').notNull(),
  canaryScope: text('canary_scope'),
  rollbackPlanSummary: text('rollback_plan_summary'),
  monitoringOwner: text('monitoring_owner'),
  stakeholderApprover: text('stakeholder_approver'),
  riskLevel: text('risk_level').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
});

export const controlledActivationGateResults = pgTable('controlled_activation_gate_results', {
  gateId: text('gate_id').primaryKey(),
  activationRequestId: text('activation_request_id').notNull().references(() => controlledActivationRequests.id),
  category: text('category').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  severity: text('severity').notNull(),
  evidenceSummary: text('evidence_summary').notNull(),
  safeReferenceId: text('safe_reference_id'),
  checkedAt: timestamp('checked_at').notNull(),
  blockerReason: text('blocker_reason'),
  recommendation: text('recommendation')
});

export const controlledActivationApprovals = pgTable('controlled_activation_approvals', {
  id: text('id').primaryKey(),
  activationRequestId: text('activation_request_id').notNull().references(() => controlledActivationRequests.id),
  approverAdminId: text('approver_admin_id').notNull(),
  approvalStatus: text('approval_status').notNull(),
  approvalNote: text('approval_note').notNull(),
  approvedAt: timestamp('approved_at').notNull().defaultNow()
});

export const controlledActivationAuditLog = pgTable('controlled_activation_audit_log', {
  id: text('id').primaryKey(),
  activationRequestId: text('activation_request_id').notNull().references(() => controlledActivationRequests.id),
  actorAdminId: text('actor_admin_id').notNull(),
  action: text('action').notNull(),
  safePayload: text('safe_payload').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
});
