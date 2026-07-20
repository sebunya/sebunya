import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const pimImportSessions = pgTable(
  "pim_import_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 160 }).notNull(),
    sourceFilename: varchar("source_filename", { length: 255 }).notNull(),
    sourceSha256: varchar("source_sha256", { length: 64 }).notNull(),
    mode: varchar("mode", { length: 20 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("UPLOADED"),
    version: integer("version").notNull().default(1),
    mapping: jsonb("mapping"),
    totalRows: integer("total_rows").notNull(),
    validRows: integer("valid_rows").notNull().default(0),
    invalidRows: integer("invalid_rows").notNull().default(0),
    createRows: integer("create_rows").notNull().default(0),
    updateRows: integer("update_rows").notNull().default(0),
    appliedRows: integer("applied_rows").notNull().default(0),
    failedRows: integer("failed_rows").notNull().default(0),
    previewDigest: varchar("preview_digest", { length: 64 }),
    createdBy: uuid("created_by").notNull(),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sourceIdx: uniqueIndex("pim_import_sessions_source_idx").on(
      table.sourceSha256,
    ),
    statusIdx: index("pim_import_sessions_status_idx").on(
      table.status,
      table.createdAt,
    ),
  }),
);

export const pimImportRows = pgTable(
  "pim_import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => pimImportSessions.id),
    rowNumber: integer("row_number").notNull(),
    sourceData: jsonb("source_data").notNull(),
    normalizedData: jsonb("normalized_data"),
    validationErrors: jsonb("validation_errors").notNull(),
    action: varchar("action", { length: 20 }).notNull().default("PENDING"),
    status: varchar("status", { length: 20 }).notNull().default("PENDING"),
    targetProductId: uuid("target_product_id"),
    beforeSnapshot: jsonb("before_snapshot"),
    afterSnapshot: jsonb("after_snapshot"),
    error: text("error"),
  },
  (table) => ({
    rowIdx: uniqueIndex("pim_import_rows_session_row_idx").on(
      table.sessionId,
      table.rowNumber,
    ),
    statusIdx: index("pim_import_rows_status_idx").on(
      table.sessionId,
      table.status,
    ),
  }),
);

export const pimImportApprovals = pgTable(
  "pim_import_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => pimImportSessions.id),
    decision: varchar("decision", { length: 20 }).notNull(),
    actorId: uuid("actor_id").notNull(),
    reason: text("reason").notNull(),
    previewDigest: varchar("preview_digest", { length: 64 }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sessionIdx: index("pim_import_approvals_session_idx").on(
      table.sessionId,
      table.decidedAt,
    ),
  }),
);
export const pimImportEvents = pgTable(
  "pim_import_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => pimImportSessions.id),
    action: varchar("action", { length: 40 }).notNull(),
    actorId: uuid("actor_id").notNull(),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sessionIdx: index("pim_import_events_session_idx").on(
      table.sessionId,
      table.createdAt,
    ),
  }),
);
