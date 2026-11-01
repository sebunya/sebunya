import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  text,
  index,
  boolean,
  integer,
  real,
} from 'drizzle-orm/pg-core';
import { users } from './identity'; // Assume a user relation if needed

// Helper for standard audit columns
const auditColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
};

const approvalColumns = {
  version: integer('version').default(1).notNull(),
  status: varchar('status', { length: 50 }).default('draft').notNull(),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  changeReason: text('change_reason'),
};

// -----------------------------------------------------------------------------
// 1. Destination Routing & Paid Social
// -----------------------------------------------------------------------------

export const measurementDestinations = pgTable('measurement_destinations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(), // 'server_gtm', 'api', 'warehouse'
  enabled: boolean('enabled').default(false).notNull(),
  description: text('description'),
  ...auditColumns,
});

export const measurementDestinationRoutes = pgTable('measurement_destination_routes', {
  id: uuid('id').defaultRandom().primaryKey(),
  destinationId: uuid('destination_id').references(() => measurementDestinations.id).notNull(),
  eventName: varchar('event_name', { length: 100 }).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  ...auditColumns,
});

export const measurementDestinationDeliveryLogs = pgTable('measurement_destination_delivery_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  destinationId: uuid('destination_id').references(() => measurementDestinations.id).notNull(),
  eventId: varchar('event_id', { length: 255 }).notNull(),
  deliveryStatus: varchar('delivery_status', { length: 50 }).notNull(), // 'success', 'failed', 'blocked'
  statusCode: integer('status_code'),
  errorDetails: text('error_details'),
  ...auditColumns,
}, (t) => ({
  eventIdIdx: index('dest_log_event_idx').on(t.eventId),
  statusIdx: index('dest_log_status_idx').on(t.deliveryStatus),
}));

export const measurementPaidSocialDestinations = pgTable('measurement_paid_social_destinations', {
  id: uuid('id').defaultRandom().primaryKey(),
  platform: varchar('platform', { length: 100 }).notNull(), // 'meta', 'tiktok', 'google_ads', etc.
  enabled: boolean('enabled').default(false).notNull(),
  credentialStatus: varchar('credential_status', { length: 50 }).default('unconfigured').notNull(),
  requiredConsent: jsonb('required_consent').notNull(), // array of required consent purposes
  allowedFields: jsonb('allowed_fields').notNull(),
  blockedFields: jsonb('blocked_fields').notNull(),
  hashingRules: jsonb('hashing_rules').notNull(),
  deduplicationKeys: jsonb('deduplication_keys').notNull(),
  retryPolicy: jsonb('retry_policy').notNull(),
  riskLevel: varchar('risk_level', { length: 50 }).default('medium').notNull(),
  ownerRole: varchar('owner_role', { length: 100 }),
  ...auditColumns,
});

export const measurementPaidSocialEventMappings = pgTable('measurement_paid_social_event_mappings', {
  id: uuid('id').defaultRandom().primaryKey(),
  destinationId: uuid('destination_id').references(() => measurementPaidSocialDestinations.id).notNull(),
  internalEventName: varchar('internal_event_name', { length: 100 }).notNull(),
  platformEventName: varchar('platform_event_name', { length: 100 }).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  ...auditColumns,
});

export const measurementPaidSocialDeliveryLogs = pgTable('measurement_paid_social_delivery_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  destinationId: uuid('destination_id').references(() => measurementPaidSocialDestinations.id).notNull(),
  eventId: varchar('event_id', { length: 255 }).notNull(),
  eventName: varchar('event_name', { length: 100 }).notNull(),
  deliveryStatus: varchar('delivery_status', { length: 50 }).notNull(),
  statusCode: integer('status_code'),
  errorDetails: text('error_details'),
  blockedReason: text('blocked_reason'),
  ...auditColumns,
}, (t) => ({
  eventIdIdx: index('paid_social_log_event_idx').on(t.eventId),
  destStatusIdx: index('paid_social_log_dest_status_idx').on(t.destinationId, t.deliveryStatus),
}));

// -----------------------------------------------------------------------------
// 2. Vendor & Campaign Attribution
// -----------------------------------------------------------------------------

export const measurementVendorRegistry = pgTable('measurement_vendor_registry', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  domain: varchar('domain', { length: 255 }),
  privacyPolicyUrl: text('privacy_policy_url'),
  dataProcessingAgreement: boolean('data_processing_agreement').default(false).notNull(),
  ...auditColumns,
  ...approvalColumns,
});

export const measurementCampaignAttribution = pgTable('measurement_campaign_attribution', {
  id: uuid('id').defaultRandom().primaryKey(),
  fpClientId: varchar('fp_client_id', { length: 255 }),
  userId: uuid('user_id'),
  utmSource: varchar('utm_source', { length: 255 }),
  utmMedium: varchar('utm_medium', { length: 255 }),
  utmCampaign: varchar('utm_campaign', { length: 255 }),
  utmContent: text('utm_content'),
  utmTerm: text('utm_term'),
  gclid: varchar('gclid', { length: 255 }),
  fbclid: varchar('fbclid', { length: 255 }),
  ttclid: varchar('ttclid', { length: 255 }),
  twclid: varchar('twclid', { length: 255 }),
  liFatId: varchar('li_fat_id', { length: 255 }),
  pinterestClickId: varchar('pinterest_click_id', { length: 255 }),
  snapchatClickId: varchar('snapchat_click_id', { length: 255 }),
  referrer: text('referrer'),
  landingPage: text('landing_page'),
  firstTouchTimestamp: timestamp('first_touch_timestamp', { withTimezone: true }),
  lastTouchTimestamp: timestamp('last_touch_timestamp', { withTimezone: true }),
  ...auditColumns,
}, (t) => ({
  fpClientIdx: index('campaign_attr_fp_idx').on(t.fpClientId),
  userIdx: index('campaign_attr_user_idx').on(t.userId),
  sourceMediumIdx: index('campaign_attr_src_med_idx').on(t.utmSource, t.utmMedium),
}));

// -----------------------------------------------------------------------------
// 3. GTM API Automation Models
// -----------------------------------------------------------------------------

export const measurementGtmAccounts = pgTable('measurement_gtm_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: varchar('account_id', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  ...auditColumns,
});

export const measurementGtmContainers = pgTable('measurement_gtm_containers', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: varchar('account_id', { length: 100 }).references(() => measurementGtmAccounts.accountId).notNull(),
  containerId: varchar('container_id', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  usageContext: jsonb('usage_context'), // e.g., ['web', 'server']
  ...auditColumns,
});

export const measurementGtmWorkspaces = pgTable('measurement_gtm_workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  containerId: varchar('container_id', { length: 100 }).references(() => measurementGtmContainers.containerId).notNull(),
  workspaceId: varchar('workspace_id', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  ...auditColumns,
});

export const measurementGtmVersions = pgTable('measurement_gtm_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  containerId: varchar('container_id', { length: 100 }).references(() => measurementGtmContainers.containerId).notNull(),
  versionId: varchar('version_id', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  description: text('description'),
  ...auditColumns,
});

export const measurementGtmSyncLogs = pgTable('measurement_gtm_sync_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  containerId: varchar('container_id', { length: 100 }).notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  details: jsonb('details'),
  ...auditColumns,
});

/**
 * Durable GTM plans (post-PR §3). Replaces a process-local in-memory Map — a
 * forbidden in-memory correctness map — so a planned (dry-run) GTM change
 * survives a restart and is consistent across instances. GTM publication stays
 * disabled; this only persists the plan/diff and a checksum for audit.
 */
export const measurementGtmPlans = pgTable('measurement_gtm_plans', {
  id: varchar('id', { length: 64 }).primaryKey(),
  plan: jsonb('plan'),
  diff: jsonb('diff'),
  planChecksum: varchar('plan_checksum', { length: 64 }),
  status: varchar('status', { length: 32 }).notNull().default('DRY_RUN'),
  version: integer('version').notNull().default(1),
  ...auditColumns,
});

// -----------------------------------------------------------------------------
// 4. Release & QA Manager
// -----------------------------------------------------------------------------

export const measurementReleaseRequests = pgTable('measurement_release_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  gtmWorkspaceId: varchar('gtm_workspace_id', { length: 100 }),
  diffPayload: jsonb('diff_payload'),
  ...auditColumns,
  ...approvalColumns,
});

export const measurementReleaseApprovals = pgTable('measurement_release_approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  releaseRequestId: uuid('release_request_id').references(() => measurementReleaseRequests.id).notNull(),
  role: varchar('role', { length: 100 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(), // 'pending', 'approved', 'rejected'
  comments: text('comments'),
  ...auditColumns,
});

export const measurementQaTests = pgTable('measurement_qa_tests', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 100 }).notNull(),
  payloadTemplate: jsonb('payload_template'),
  expectedResult: jsonb('expected_result'),
  ...auditColumns,
});

export const measurementQaResults = pgTable('measurement_qa_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  testId: uuid('test_id').references(() => measurementQaTests.id).notNull(),
  releaseRequestId: uuid('release_request_id').references(() => measurementReleaseRequests.id),
  status: varchar('status', { length: 50 }).notNull(), // 'pass', 'fail'
  actualResult: jsonb('actual_result'),
  errorLog: text('error_log'),
  ...auditColumns,
});

// -----------------------------------------------------------------------------
// 5. Data Quality & Dashboard
// -----------------------------------------------------------------------------

export const measurementDataQualityRules = pgTable('measurement_data_quality_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  eventMatch: varchar('event_match', { length: 100 }).notNull(),
  condition: jsonb('condition').notNull(),
  severity: varchar('severity', { length: 50 }).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  ...auditColumns,
});

export const measurementDataQualityAlerts = pgTable('measurement_data_quality_alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  ruleId: uuid('rule_id').references(() => measurementDataQualityRules.id).notNull(),
  eventId: varchar('event_id', { length: 255 }),
  alertMessage: text('alert_message').notNull(),
  status: varchar('status', { length: 50 }).default('open').notNull(), // 'open', 'resolved'
  ...auditColumns,
});

export const measurementDashboardMetrics = pgTable('measurement_dashboard_metrics', {
  id: uuid('id').defaultRandom().primaryKey(),
  metricName: varchar('metric_name', { length: 100 }).notNull(),
  metricValue: real('metric_value').notNull(),
  dimensions: jsonb('dimensions'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  metricTimeIdx: index('dash_metric_time_idx').on(t.metricName, t.timestamp),
}));

export const measurementAuditLogs = pgTable('measurement_audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityType: varchar('entity_type', { length: 100 }).notNull(),
  entityId: varchar('entity_id', { length: 255 }).notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  changes: jsonb('changes'),
  ...auditColumns,
});

// -----------------------------------------------------------------------------
// 6. Admin Governance & RBAC
// -----------------------------------------------------------------------------

export const measurementAdminRoles = pgTable('measurement_admin_roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  ...auditColumns,
});

export const measurementAdminPermissions = pgTable('measurement_admin_permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  roleId: uuid('role_id').references(() => measurementAdminRoles.id).notNull(),
  resource: varchar('resource', { length: 100 }).notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  ...auditColumns,
});

export const measurementIncidents = pgTable('measurement_incidents', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  severity: varchar('severity', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).default('investigating').notNull(),
  description: text('description'),
  resolution: text('resolution'),
  ...auditColumns,
});

export const measurementApiFailures = pgTable('measurement_api_failures', {
  id: uuid('id').defaultRandom().primaryKey(),
  apiName: varchar('api_name', { length: 100 }).notNull(),
  endpoint: varchar('endpoint', { length: 255 }).notNull(),
  statusCode: integer('status_code'),
  errorPayload: jsonb('error_payload'),
  ...auditColumns,
});

export const measurementDeadLetterEvents = pgTable('measurement_dead_letter_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceQueue: varchar('source_queue', { length: 100 }).notNull(),
  payload: jsonb('payload').notNull(),
  errorReason: text('error_reason').notNull(),
  retryCount: integer('retry_count').default(0).notNull(),
  isResolved: boolean('is_resolved').default(false).notNull(),
  ...auditColumns,
});
