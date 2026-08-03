import { pgTable, uuid, varchar, timestamp, integer, uniqueIndex, index } from 'drizzle-orm/pg-core';

/**
 * Operator wording overrides for transactional notifications (Wave 2E-3).
 *
 * The renderer's code strings remain the canonical FALLBACK; a PUBLISHED row
 * overrides individual fields (null field = keep the code default). At most one
 * DRAFT and one PUBLISHED row per template key; publishing replaces the previous
 * published row inside one transaction, so senders never observe a half-updated
 * template.
 */
export const notificationTemplateOverrides = pgTable(
  'notification_template_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    templateKey: varchar('template_key', { length: 50 }).notNull(),
    subject: varchar('subject', { length: 200 }),
    preheader: varchar('preheader', { length: 300 }),
    headline: varchar('headline', { length: 200 }),
    status: varchar('status', { length: 12 }).default('DRAFT').notNull(), // DRAFT | PUBLISHED
    version: integer('version').default(1).notNull(),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    keyStatusUq: uniqueIndex('notification_template_overrides_key_status_uq').on(t.templateKey, t.status),
    keyIdx: index('notification_template_overrides_key_idx').on(t.templateKey),
  }),
);
