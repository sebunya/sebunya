import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const canonicalConsentStateEnum = pgEnum('canonical_consent_state', [
  'unknown',
  'not_requested',
  'requested_support_assisted',
  'pending_verification',
  'granted',
  'withdrawn',
  'expired',
  'superseded',
  'blocked_by_policy',
  'service_only',
]);

export const consentActorTypeEnum = pgEnum('consent_actor_type', [
  'customer',
  'support_operator',
  'admin',
  'provider_callback',
  'system_policy',
  'migration_dry_run',
  'test_fixture',
]);

export const consentIdentityLevelEnum = pgEnum('consent_identity_level', [
  'anonymous',
  'checkout_contact_only',
  'support_verified_contact',
  'verified_account',
  'provider_callback_verified',
  'admin_operator_confirmed',
]);

export const legacyMappingOutcomeEnum = pgEnum('consent_legacy_mapping_outcome', [
  'unknown',
  'requested_support_assisted',
  'not_applicable',
]);

export const consentPurposes = pgTable('consent_purposes', {
  id: uuid('id').defaultRandom().primaryKey(),
  purposeKey: varchar('purpose_key', { length: 100 }).notNull(),
  policyVersion: varchar('policy_version', { length: 50 }).notNull(),
  classification: varchar('classification', { length: 50 }).notNull(),
  owner: varchar('owner', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  supersededBy: uuid('superseded_by'),
}, (table) => ({
  keyVersionUnique: uniqueIndex('consent_purposes_key_version_uidx').on(table.purposeKey, table.policyVersion),
  activeLookup: index('consent_purposes_active_idx').on(table.purposeKey, table.effectiveAt, table.expiresAt),
}));

export const consentChannels = pgTable('consent_channels', {
  id: uuid('id').defaultRandom().primaryKey(),
  channelKey: varchar('channel_key', { length: 50 }).notNull(),
  policyVersion: varchar('policy_version', { length: 50 }).notNull(),
  verificationRequirement: varchar('verification_requirement', { length: 80 }).notNull(),
  suppressionScope: varchar('suppression_scope', { length: 50 }).notNull(),
  owner: varchar('owner', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  supersededBy: uuid('superseded_by'),
}, (table) => ({
  keyVersionUnique: uniqueIndex('consent_channels_key_version_uidx').on(table.channelKey, table.policyVersion),
  activeLookup: index('consent_channels_active_idx').on(table.channelKey, table.effectiveAt, table.expiresAt),
}));

export const consentCopyVersions = pgTable('consent_copy_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  copyVersionId: varchar('copy_version_id', { length: 100 }).notNull().unique(),
  purposeKey: varchar('purpose_key', { length: 100 }).notNull(),
  channelKey: varchar('channel_key', { length: 50 }).notNull(),
  locale: varchar('locale', { length: 20 }).notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  policyVersion: varchar('policy_version', { length: 50 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  supersededBy: uuid('superseded_by'),
}, (table) => ({
  purposeChannelLookup: index('consent_copy_versions_purpose_channel_idx').on(table.purposeKey, table.channelKey),
  contentHashLookup: index('consent_copy_versions_hash_idx').on(table.contentHash),
}));

export const consentSourceSurfaces = pgTable('consent_source_surfaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceSurface: varchar('source_surface', { length: 100 }).notNull(),
  policyVersion: varchar('policy_version', { length: 50 }).notNull(),
  actorClass: varchar('actor_class', { length: 50 }).notNull(),
  verificationFloor: consentIdentityLevelEnum('verification_floor').notNull(),
  authorityClass: varchar('authority_class', { length: 50 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  supersededBy: uuid('superseded_by'),
}, (table) => ({
  sourceVersionUnique: uniqueIndex('consent_source_surfaces_source_version_uidx').on(table.sourceSurface, table.policyVersion),
  authorityLookup: index('consent_source_surfaces_authority_idx').on(table.authorityClass, table.verificationFloor),
}));

export const customerConsentStates = pgTable('customer_consent_states', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerIdentityRef: varchar('customer_identity_ref', { length: 255 }).notNull(),
  endpointRef: varchar('endpoint_ref', { length: 255 }).notNull(),
  purposeKey: varchar('purpose_key', { length: 100 }).notNull(),
  channelKey: varchar('channel_key', { length: 50 }).notNull(),
  identityVerificationLevel: consentIdentityLevelEnum('identity_verification_level').notNull(),
  state: canonicalConsentStateEnum('state').default('unknown').notNull(),
  sourceSurface: varchar('source_surface', { length: 100 }).notNull(),
  copyVersionId: varchar('copy_version_id', { length: 100 }),
  lastConsentEventId: uuid('last_consent_event_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  supersededBy: uuid('superseded_by'),
}, (table) => ({
  aggregateUnique: uniqueIndex('customer_consent_states_aggregate_uidx').on(
    table.customerIdentityRef,
    table.endpointRef,
    table.purposeKey,
    table.channelKey,
  ),
  stateLookup: index('customer_consent_states_state_idx').on(table.state, table.expiresAt),
  identityLookup: index('customer_consent_states_identity_idx').on(table.customerIdentityRef, table.purposeKey),
  noAnonymousGrant: check(
    'customer_consent_states_no_anonymous_grant_chk',
    sql`${table.state} <> 'granted' OR ${table.identityVerificationLevel} <> 'anonymous'`,
  ),
  noCheckoutMarketingGrant: check(
    'customer_consent_states_no_checkout_marketing_grant_chk',
    sql`${table.state} <> 'granted' OR ${table.purposeKey} <> 'marketing_offers_campaigns' OR ${table.identityVerificationLevel} <> 'checkout_contact_only'`,
  ),
}));

export const consentEvents = pgTable('consent_events', {
  consentEventId: uuid('consent_event_id').defaultRandom().primaryKey(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  customerIdentityRef: varchar('customer_identity_ref', { length: 255 }).notNull(),
  endpointRef: varchar('endpoint_ref', { length: 255 }),
  purposeKey: varchar('purpose_key', { length: 100 }).notNull(),
  channelKey: varchar('channel_key', { length: 50 }).notNull(),
  state: canonicalConsentStateEnum('state').notNull(),
  sourceSurface: varchar('source_surface', { length: 100 }).notNull(),
  actorType: consentActorTypeEnum('actor_type').notNull(),
  actorId: varchar('actor_id', { length: 255 }),
  copyVersionId: varchar('copy_version_id', { length: 100 }),
  previousState: canonicalConsentStateEnum('previous_state'),
  newState: canonicalConsentStateEnum('new_state').notNull(),
  reason: text('reason').notNull(),
  providerCallbackRef: varchar('provider_callback_ref', { length: 255 }),
  supportTicketRef: varchar('support_ticket_ref', { length: 255 }),
  correlationId: varchar('correlation_id', { length: 255 }).notNull(),
  retentionPolicy: varchar('retention_policy', { length: 100 }).notNull(),
  integrityHash: varchar('integrity_hash', { length: 64 }),
  tamperEvidenceRef: varchar('tamper_evidence_ref', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
}, (table) => ({
  aggregateAuditLookup: index('consent_events_aggregate_audit_idx').on(
    table.customerIdentityRef,
    table.purposeKey,
    table.channelKey,
    table.effectiveAt,
  ),
  correlationLookup: index('consent_events_correlation_idx').on(table.correlationId),
  providerCallbackLookup: index('consent_events_provider_callback_idx').on(table.providerCallbackRef),
  tamperEvidenceRequired: check(
    'consent_events_tamper_evidence_chk',
    sql`${table.integrityHash} IS NOT NULL OR ${table.tamperEvidenceRef} IS NOT NULL`,
  ),
}));

export const channelSuppressions = pgTable('channel_suppressions', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerIdentityRef: varchar('customer_identity_ref', { length: 255 }),
  endpointRef: varchar('endpoint_ref', { length: 255 }).notNull(),
  channelKey: varchar('channel_key', { length: 50 }).notNull(),
  purposeKey: varchar('purpose_key', { length: 100 }),
  scope: varchar('scope', { length: 50 }).notNull(),
  reason: text('reason').notNull(),
  sourceSurface: varchar('source_surface', { length: 100 }).notNull(),
  providerCallbackRef: varchar('provider_callback_ref', { length: 255 }),
  suppressionActive: boolean('suppression_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  supersededBy: uuid('superseded_by'),
}, (table) => ({
  activeSuppressionLookup: index('channel_suppressions_active_idx').on(
    table.endpointRef,
    table.channelKey,
    table.purposeKey,
    table.suppressionActive,
  ),
  providerCallbackLookup: index('channel_suppressions_provider_callback_idx').on(table.providerCallbackRef),
}));

export const providerUnsubscribeEvents = pgTable('provider_unsubscribe_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  providerKey: varchar('provider_key', { length: 100 }).notNull(),
  providerEventRef: varchar('provider_event_ref', { length: 255 }).notNull(),
  providerCallbackRef: varchar('provider_callback_ref', { length: 255 }).notNull(),
  endpointRef: varchar('endpoint_ref', { length: 255 }).notNull(),
  channelKey: varchar('channel_key', { length: 50 }).notNull(),
  purposeKey: varchar('purpose_key', { length: 100 }),
  scope: varchar('scope', { length: 50 }).notNull(),
  authenticityVerified: boolean('authenticity_verified').notNull(),
  freshnessVerified: boolean('freshness_verified').notNull(),
  providerOccurredAt: timestamp('provider_occurred_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  correlationId: varchar('correlation_id', { length: 255 }).notNull(),
  integrityHash: varchar('integrity_hash', { length: 64 }),
  tamperEvidenceRef: varchar('tamper_evidence_ref', { length: 255 }),
  normalizedEvidence: jsonb('normalized_evidence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  providerEventUnique: uniqueIndex('provider_unsubscribe_events_provider_event_uidx').on(
    table.providerKey,
    table.providerEventRef,
  ),
  suppressionLookup: index('provider_unsubscribe_events_suppression_idx').on(table.endpointRef, table.channelKey),
  tamperEvidenceRequired: check(
    'provider_unsubscribe_events_tamper_evidence_chk',
    sql`${table.integrityHash} IS NOT NULL OR ${table.tamperEvidenceRef} IS NOT NULL`,
  ),
}));

export const supportAssistedPreferenceRequests = pgTable('support_assisted_preference_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerIdentityRef: varchar('customer_identity_ref', { length: 255 }).notNull(),
  endpointRef: varchar('endpoint_ref', { length: 255 }),
  purposeKey: varchar('purpose_key', { length: 100 }).notNull(),
  channelKey: varchar('channel_key', { length: 50 }).notNull(),
  requestedState: canonicalConsentStateEnum('requested_state').notNull(),
  identityVerificationLevel: consentIdentityLevelEnum('identity_verification_level').notNull(),
  verificationStatus: varchar('verification_status', { length: 50 }).notNull(),
  supportTicketRef: varchar('support_ticket_ref', { length: 255 }).notNull(),
  actorType: consentActorTypeEnum('actor_type').notNull(),
  actorId: varchar('actor_id', { length: 255 }).notNull(),
  scriptCopyVersionId: varchar('script_copy_version_id', { length: 100 }).notNull(),
  correlationId: varchar('correlation_id', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  supersededBy: uuid('superseded_by'),
}, (table) => ({
  ticketLookup: index('support_assisted_preference_requests_ticket_idx').on(table.supportTicketRef),
  pendingLookup: index('support_assisted_preference_requests_pending_idx').on(
    table.customerIdentityRef,
    table.verificationStatus,
    table.expiresAt,
  ),
  noDirectGrant: check(
    'support_assisted_requests_no_direct_grant_chk',
    sql`${table.requestedState} <> 'granted'`,
  ),
}));

export const legacyPreferenceMappings = pgTable('legacy_preference_mappings', {
  id: uuid('id').defaultRandom().primaryKey(),
  mappingVersion: varchar('mapping_version', { length: 50 }).notNull(),
  legacySystem: varchar('legacy_system', { length: 100 }).notNull(),
  legacyField: varchar('legacy_field', { length: 100 }).notNull(),
  legacyValueClass: varchar('legacy_value_class', { length: 100 }).notNull(),
  targetPurposeKey: varchar('target_purpose_key', { length: 100 }),
  targetChannelKey: varchar('target_channel_key', { length: 50 }),
  mappingOutcome: legacyMappingOutcomeEnum('mapping_outcome').default('unknown').notNull(),
  confidence: varchar('confidence', { length: 20 }).notNull(),
  reason: text('reason').notNull(),
  reviewStatus: varchar('review_status', { length: 50 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  supersededBy: uuid('superseded_by'),
}, (table) => ({
  mappingUnique: uniqueIndex('legacy_preference_mappings_rule_uidx').on(
    table.mappingVersion,
    table.legacySystem,
    table.legacyField,
    table.legacyValueClass,
  ),
  reviewLookup: index('legacy_preference_mappings_review_idx').on(table.reviewStatus, table.mappingOutcome),
}));

export const consentPolicyBlocks = pgTable('consent_policy_blocks', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerIdentityRef: varchar('customer_identity_ref', { length: 255 }),
  cohortRef: varchar('cohort_ref', { length: 255 }),
  purposeKey: varchar('purpose_key', { length: 100 }),
  channelKey: varchar('channel_key', { length: 50 }),
  policyBlockReason: text('policy_block_reason').notNull(),
  policyVersion: varchar('policy_version', { length: 50 }).notNull(),
  actorType: consentActorTypeEnum('actor_type').notNull(),
  actorId: varchar('actor_id', { length: 255 }),
  correlationId: varchar('correlation_id', { length: 255 }).notNull(),
  integrityHash: varchar('integrity_hash', { length: 64 }),
  tamperEvidenceRef: varchar('tamper_evidence_ref', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  supersededBy: uuid('superseded_by'),
}, (table) => ({
  activePolicyLookup: index('consent_policy_blocks_active_idx').on(
    table.customerIdentityRef,
    table.purposeKey,
    table.channelKey,
    table.expiresAt,
  ),
  cohortPolicyLookup: index('consent_policy_blocks_cohort_idx').on(table.cohortRef, table.purposeKey),
  scopeRequired: check(
    'consent_policy_blocks_scope_chk',
    sql`${table.customerIdentityRef} IS NOT NULL OR ${table.cohortRef} IS NOT NULL`,
  ),
  tamperEvidenceRequired: check(
    'consent_policy_blocks_tamper_evidence_chk',
    sql`${table.integrityHash} IS NOT NULL OR ${table.tamperEvidenceRef} IS NOT NULL`,
  ),
}));
