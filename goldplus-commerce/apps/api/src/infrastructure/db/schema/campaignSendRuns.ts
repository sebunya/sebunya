import { pgTable, uuid, varchar, timestamp, integer, index } from 'drizzle-orm/pg-core';
import { campaigns } from './advertising';

/**
 * Campaign send-engine decision ledger (send wave, DRY-RUN ONLY).
 *
 * A run evaluates the eligibility pipeline — identity → consent → suppression →
 * frequency → quiet hours — and records one decision row per audience subject.
 * The ledger IS the product of this wave: it shows exactly who WOULD receive and
 * the precise gate that excluded everyone else. Rows carry the subject reference
 * (cart id), never message content and never raw contact details. LIVE mode does
 * not exist in this schema's vocabulary.
 */
export const campaignSendRuns = pgTable(
  'campaign_send_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }).notNull(),
    mode: varchar('mode', { length: 12 }).default('DRY_RUN').notNull(), // DRY_RUN only
    status: varchar('status', { length: 20 }).default('COMPLETE').notNull(), // COMPLETE | BLOCKED
    audienceKind: varchar('audience_kind', { length: 30 }).default('ABANDONED_CARTS').notNull(),
    candidates: integer('candidates').default(0).notNull(),
    eligible: integer('eligible').default(0).notNull(),
    excludedNoIdentity: integer('excluded_no_identity').default(0).notNull(),
    excludedNoConsent: integer('excluded_no_consent').default(0).notNull(),
    excludedSuppressed: integer('excluded_suppressed').default(0).notNull(),
    excludedFrequency: integer('excluded_frequency').default(0).notNull(),
    quietHoursAtRun: varchar('quiet_hours_at_run', { length: 8 }).default('NO').notNull(), // YES | NO
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ campaignIdx: index('campaign_send_runs_campaign_idx').on(t.campaignId) }),
);

export const campaignSendDecisions = pgTable(
  'campaign_send_decisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id').references(() => campaignSendRuns.id, { onDelete: 'cascade' }).notNull(),
    subjectRef: uuid('subject_ref').notNull(), // cart id — never a contact detail
    decision: varchar('decision', { length: 24 }).notNull(), // ELIGIBLE | NO_IDENTITY | NO_CONSENT | SUPPRESSED | FREQUENCY_CAPPED
    detail: varchar('detail', { length: 300 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    runIdx: index('campaign_send_decisions_run_idx').on(t.runId),
    subjectIdx: index('campaign_send_decisions_subject_idx').on(t.subjectRef),
  }),
);
