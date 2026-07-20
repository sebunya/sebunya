import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

export const surveyDefinitions = pgTable('survey_definitions', {
  id: uuid('id').primaryKey().defaultRandom(), key: varchar('key', { length: 80 }).notNull(), status: varchar('status', { length: 30 }).notNull().default('DRAFT'), version: integer('version').notNull().default(1), currentVersionId: uuid('current_version_id').notNull(), createdBy: uuid('created_by').notNull(), approvedBy: uuid('approved_by'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ keyIdx: uniqueIndex('survey_definitions_key_idx').on(table.key), statusIdx: index('survey_definitions_status_idx').on(table.status, table.updatedAt) }));

export const surveyVersions = pgTable('survey_versions', {
  id: uuid('id').primaryKey(), definitionId: uuid('definition_id').notNull().references(() => surveyDefinitions.id), versionNumber: integer('version_number').notNull(), title: varchar('title', { length: 160 }).notNull(), description: text('description').notNull(), purposeKey: varchar('purpose_key', { length: 100 }).notNull(), questions: jsonb('questions').notNull(), audience: jsonb('audience').notNull(), contentDigest: varchar('content_digest', { length: 64 }).notNull(), createdBy: uuid('created_by').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ versionIdx: uniqueIndex('survey_versions_definition_version_idx').on(table.definitionId, table.versionNumber), digestIdx: uniqueIndex('survey_versions_digest_idx').on(table.definitionId, table.contentDigest) }));

export const surveyResponses = pgTable('survey_responses', {
  id: uuid('id').primaryKey().defaultRandom(), definitionId: uuid('definition_id').notNull().references(() => surveyDefinitions.id), versionId: uuid('version_id').notNull().references(() => surveyVersions.id), participantRefHash: varchar('participant_ref_hash', { length: 64 }).notNull(), consentEvidence: jsonb('consent_evidence').notNull(), answers: jsonb('answers').notNull(), status: varchar('status', { length: 20 }).notNull().default('IN_PROGRESS'), version: integer('version').notNull().default(1), startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(), completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({ participantIdx: uniqueIndex('survey_responses_definition_participant_idx').on(table.definitionId, table.participantRefHash), statusIdx: index('survey_responses_status_idx').on(table.definitionId, table.status) }));

export const surveyEvents = pgTable('survey_events', {
  id: uuid('id').primaryKey().defaultRandom(), definitionId: uuid('definition_id').notNull().references(() => surveyDefinitions.id), action: varchar('action', { length: 40 }).notNull(), actorId: uuid('actor_id').notNull(), reason: text('reason').notNull(), evidence: jsonb('evidence').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ definitionIdx: index('survey_events_definition_idx').on(table.definitionId, table.createdAt) }));
