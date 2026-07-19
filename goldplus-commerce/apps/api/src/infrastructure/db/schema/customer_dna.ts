import { pgTable, uuid, varchar, integer, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Customer DNA — canonical derived profile projection + identity links + feature/
 * lifecycle snapshots + NBA decision evidence. A projection over authoritative
 * source systems; it never replaces them and never stores fabricated data.
 */

export const customerProfiles = pgTable(
  'customer_profiles',
  {
    canonicalCustomerId: uuid('canonical_customer_id').defaultRandom().primaryKey(),
    profileVersion: integer('profile_version').default(1).notNull(),
    sourceVersion: integer('source_version').default(0).notNull(),
    accountUserId: uuid('account_user_id').references(() => users.id),
    identityConfidence: varchar('identity_confidence', { length: 16 }).default('LOW').notNull(),
    firstSeen: timestamp('first_seen', { withTimezone: true }),
    lastSeen: timestamp('last_seen', { withTimezone: true }),
    primaryLifecycleStage: varchar('primary_lifecycle_stage', { length: 20 }).default('UNKNOWN').notNull(),
    valueFlags: jsonb('value_flags').default([]).notNull(),
    riskFlags: jsonb('risk_flags').default([]).notNull(),
    consentEligible: boolean('consent_eligible'),
    communicationPreferences: jsonb('communication_preferences'),
    staleAfterHours: integer('stale_after_hours').default(24).notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    accountIdx: index('customer_profiles_account_idx').on(table.accountUserId),
    lifecycleIdx: index('customer_profiles_lifecycle_idx').on(table.primaryLifecycleStage),
  })
);

export const customerIdentityLinks = pgTable(
  'customer_identity_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    canonicalCustomerId: uuid('canonical_customer_id').references(() => customerProfiles.canonicalCustomerId).notNull(),
    signalType: varchar('signal_type', { length: 40 }).notNull(),
    identifierKey: varchar('identifier_key', { length: 128 }).notNull(),
    confidence: varchar('confidence', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).default('ACTIVE').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // One identifier binds to exactly one canonical customer — the uniqueness that
    // makes re-linking idempotent and surfaces conflicts.
    signalIdentifierIdx: uniqueIndex('customer_identity_links_signal_identifier_idx').on(table.signalType, table.identifierKey),
    canonicalIdx: index('customer_identity_links_canonical_idx').on(table.canonicalCustomerId),
  })
);

export const customerFeatureSnapshots = pgTable(
  'customer_feature_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    canonicalCustomerId: uuid('canonical_customer_id').references(() => customerProfiles.canonicalCustomerId).notNull(),
    sourceVersion: integer('source_version').notNull(),
    features: jsonb('features').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionIdx: uniqueIndex('customer_feature_snapshots_version_idx').on(table.canonicalCustomerId, table.sourceVersion),
  })
);

export const customerLifecycleSnapshots = pgTable(
  'customer_lifecycle_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    canonicalCustomerId: uuid('canonical_customer_id').references(() => customerProfiles.canonicalCustomerId).notNull(),
    stage: varchar('stage', { length: 20 }).notNull(),
    policyVersion: integer('policy_version').notNull(),
    sourceVersion: integer('source_version').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionIdx: uniqueIndex('customer_lifecycle_snapshots_version_idx').on(table.canonicalCustomerId, table.sourceVersion, table.policyVersion),
  })
);

export const nbaDecisions = pgTable(
  'nba_decisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    canonicalCustomerId: uuid('canonical_customer_id').references(() => customerProfiles.canonicalCustomerId).notNull(),
    profileVersion: integer('profile_version').notNull(),
    selectedAction: varchar('selected_action', { length: 30 }).notNull(),
    selectedTargetRef: varchar('selected_target_ref', { length: 128 }),
    reasonCodes: jsonb('reason_codes').notNull(),
    policyVersion: integer('policy_version').notNull(),
    decisionKey: varchar('decision_key', { length: 200 }).notNull(),
    activationState: varchar('activation_state', { length: 20 }).default('PENDING').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Idempotent decision request per (customer, profile version, policy, key).
    decisionKeyIdx: uniqueIndex('nba_decisions_key_idx').on(table.decisionKey),
    canonicalIdx: index('nba_decisions_canonical_idx').on(table.canonicalCustomerId),
  })
);

export const nbaCandidates = pgTable(
  'nba_candidates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    decisionId: uuid('decision_id').references(() => nbaDecisions.id).notNull(),
    actionType: varchar('action_type', { length: 30 }).notNull(),
    targetRef: varchar('target_ref', { length: 128 }),
    eligible: boolean('eligible').notNull(),
    exclusionReason: varchar('exclusion_reason', { length: 40 }),
    score: integer('score').notNull(),
    reasonCodes: jsonb('reason_codes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    decisionIdx: index('nba_candidates_decision_idx').on(table.decisionId),
  })
);
