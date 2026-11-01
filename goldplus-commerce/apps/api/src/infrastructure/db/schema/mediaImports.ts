import { pgTable, uuid, varchar, text, integer, smallint, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { mediaAssets } from './media';
import { products } from './products';

/** Focus 4 (0149) — reviewed bulk image import: sessions and their resumable row ledger. */
export const mediaImportSessions = pgTable(
  'media_import_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 160 }).notNull(),
    status: text('status').notNull().default('PLANNED'), // PLANNED | APPROVED | REJECTED | APPLYING | APPLIED | PARTIALLY_APPLIED | FAILED
    version: integer('version').notNull().default(1),
    importerVersion: varchar('importer_version', { length: 60 }).notNull(),
    manifestSha256: varchar('manifest_sha256', { length: 64 }),
    manifestFilename: varchar('manifest_filename', { length: 255 }),
    planHash: varchar('plan_hash', { length: 64 }).notNull(),
    totals: jsonb('totals').notNull().default({}),
    blocking: boolean('blocking').notNull().default(true),
    createdBy: uuid('created_by').notNull(),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedReason: varchar('rejected_reason', { length: 500 }),
    appliedBy: uuid('applied_by'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    applySummary: jsonb('apply_summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ statusIdx: index('media_import_sessions_status_idx').on(t.status, t.createdAt) }),
);

export const mediaImportRows = pgTable(
  'media_import_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull().references(() => mediaImportSessions.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    filename: varchar('filename', { length: 255 }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    assetId: uuid('asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    skuToken: varchar('sku_token', { length: 120 }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    productSku: varchar('product_sku', { length: 50 }),
    slot: smallint('slot'),
    role: varchar('role', { length: 40 }),
    altText: varchar('alt_text', { length: 255 }),
    source: varchar('source', { length: 20 }).notNull().default('FILENAME'),
    status: text('status').notNull(),
    issues: jsonb('issues').$type<string[]>().notNull().default([]),
    expectedRevision: integer('expected_revision'),
    currentMap: jsonb('current_map'),
    proposedMap: jsonb('proposed_map'),
    applyStatus: text('apply_status'), // APPLIED | FAILED | NOT_ATTEMPTED | SKIPPED | STALE
    appliedRevision: integer('applied_revision'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionRowUq: uniqueIndex('media_import_rows_session_row_uq').on(t.sessionId, t.rowNumber),
    productIdx: index('media_import_rows_product_idx').on(t.productId),
  }),
);
