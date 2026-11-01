import { pgTable, uuid, varchar, timestamp, integer, text, index, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Legal policy CMS (Wave 2C).
 *
 * One `legal_policies` row per policy key; `legal_policy_versions` is append-only
 * history. Governance lives in the use case: a version's body is immutable once it
 * leaves IN_REVIEW, approval requires a different actor than the author
 * (maker/checker), and the public page resolves exactly one current version via
 * `current_version_id`. Rollback re-points the pointer — history is never rewritten.
 */

export const legalPolicies = pgTable(
  'legal_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: varchar('key', { length: 40 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    currentVersionId: uuid('current_version_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ keyUq: uniqueIndex('legal_policies_key_uq').on(t.key) }),
);

export const legalPolicyVersions = pgTable(
  'legal_policy_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    policyId: uuid('policy_id').references(() => legalPolicies.id, { onDelete: 'cascade' }).notNull(),
    version: integer('version').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    bodyMarkdown: text('body_markdown').notNull(),
    changeNote: varchar('change_note', { length: 500 }),
    status: varchar('status', { length: 20 }).default('DRAFT').notNull(), // DRAFT | IN_REVIEW | APPROVED | SCHEDULED | PUBLISHED | ARCHIVED
    effectiveAt: timestamp('effective_at', { withTimezone: true }),
    seoTitle: varchar('seo_title', { length: 200 }),
    seoDescription: varchar('seo_description', { length: 300 }),
    locale: varchar('locale', { length: 10 }).default('en').notNull(),
    createdBy: uuid('created_by'),
    approvedBy: uuid('approved_by'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    policyVersionUq: uniqueIndex('legal_policy_versions_policy_version_uq').on(t.policyId, t.version),
    policyIdx: index('legal_policy_versions_policy_idx').on(t.policyId),
    statusIdx: index('legal_policy_versions_status_idx').on(t.status),
  }),
);
