import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * SEO Integrations Control Plane (migration 0118).
 *
 * Provider registry + connection lifecycle + encrypted credential vault +
 * sync jobs + integration audit + usage caps. CHECK constraints live in the
 * hand-written migration; definitions below mirror it for the query builder.
 *
 * The credentials table stores AES-256-GCM ciphertext and a display mask
 * ONLY — there is no plaintext column anywhere in this schema.
 */

export const seoIntegrationProviders = pgTable('seo_integration_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerId: text('provider_id').notNull(),
  canonicalName: text('canonical_name').notNull(),
  family: text('family').notNull(),
  description: text('description').notNull().default(''),
  authTypes: jsonb('auth_types').notNull().default([]),
  capabilities: jsonb('capabilities').notNull().default([]),
  supports: jsonb('supports').notNull().default({}),
  defaultSyncFrequency: text('default_sync_frequency'),
  docsUrl: text('docs_url'),
  enabled: boolean('enabled').notNull().default(true),
  experimental: boolean('experimental').notNull().default(false),
  adapterVersion: text('adapter_version').notNull().default('1'),
  manifest: jsonb('manifest').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerIdIdx: uniqueIndex('seo_int_providers_provider_id_idx').on(t.providerId),
}));

export const seoIntegrationConnections = pgTable('seo_integration_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerId: text('provider_id').notNull().references(() => seoIntegrationProviders.providerId),
  name: text('name').notNull(),
  status: text('status').notNull().default('NOT_CONFIGURED'),
  accountRef: text('account_ref'),
  propertyRef: text('property_ref'),
  config: jsonb('config').notNull().default({}),
  enabledCapabilities: jsonb('enabled_capabilities').notNull().default([]),
  syncFrequency: text('sync_frequency'),
  backfillWindowDays: integer('backfill_window_days'),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastError: text('last_error'),
  dataFreshnessAt: timestamp('data_freshness_at', { withTimezone: true }),
  quotaState: jsonb('quota_state'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerIdx: index('seo_int_connections_provider_idx').on(t.providerId),
  statusIdx: index('seo_int_connections_status_idx').on(t.status),
}));

export const seoIntegrationCredentials = pgTable('seo_integration_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  connectionId: uuid('connection_id').notNull().references(() => seoIntegrationConnections.id, { onDelete: 'cascade' }),
  authType: text('auth_type').notNull(),
  ciphertext: text('ciphertext').notNull(),
  mask: text('mask').notNull(),
  version: integer('version').notNull().default(1),
  status: text('status').notNull().default('ACTIVE'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  lastRotatedAt: timestamp('last_rotated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  connectionIdx: index('seo_int_credentials_connection_idx').on(t.connectionId, t.status),
}));

export const seoIntegrationSyncJobs = pgTable('seo_integration_sync_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  connectionId: uuid('connection_id').notNull().references(() => seoIntegrationConnections.id, { onDelete: 'cascade' }),
  jobType: text('job_type').notNull(),
  status: text('status').notNull().default('QUEUED'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  recordsRead: integer('records_read').notNull().default(0),
  recordsInserted: integer('records_inserted').notNull().default(0),
  recordsUpdated: integer('records_updated').notNull().default(0),
  recordsRejected: integer('records_rejected').notNull().default(0),
  cursor: jsonb('cursor'),
  error: text('error'),
  requestedBy: uuid('requested_by'),
}, (t) => ({
  connectionIdx: index('seo_int_sync_jobs_connection_idx').on(t.connectionId, t.requestedAt),
  statusIdx: index('seo_int_sync_jobs_status_idx').on(t.status),
}));

export const seoIntegrationAudit = pgTable('seo_integration_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  connectionId: uuid('connection_id'),
  providerId: text('provider_id'),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  detail: jsonb('detail').notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  occurredIdx: index('seo_int_audit_occurred_idx').on(t.occurredAt),
  connectionIdx: index('seo_int_audit_connection_idx').on(t.connectionId),
}));

export const seoIntegrationUsage = pgTable('seo_integration_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerId: text('provider_id').notNull(),
  day: date('day').notNull(),
  requestCount: integer('request_count').notNull().default(0),
}, (t) => ({
  providerDayIdx: uniqueIndex('seo_int_usage_provider_day_idx').on(t.providerId, t.day),
}));
