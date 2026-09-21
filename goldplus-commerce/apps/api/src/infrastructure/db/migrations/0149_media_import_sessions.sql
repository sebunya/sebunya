-- Focus 4 (0149): reviewed bulk image import — a plan a person approves before
-- anything touches a gallery. Mirrors the battery-import shape the team already
-- operates (session → rows → four-eyes approval → per-product apply → ledger).
--
-- A session records the source (manifest hash), the importer version, the plan
-- hash and totals; a row records one file: what it resolved to, the product's
-- expected media revision, the current and proposed slot maps, its status and
-- what happened when it was applied. Rows are the resumable ledger: APPLIED /
-- FAILED / NOT_ATTEMPTED per product, never "the batch succeeded".
--
-- Rollback: DROP TABLE media_import_rows; DROP TABLE media_import_sessions;
CREATE TABLE IF NOT EXISTS "media_import_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(160) NOT NULL,
  "status" text NOT NULL DEFAULT 'PLANNED',
  "version" integer NOT NULL DEFAULT 1,
  "importer_version" varchar(60) NOT NULL,
  "manifest_sha256" varchar(64),
  "manifest_filename" varchar(255),
  "plan_hash" varchar(64) NOT NULL,
  "totals" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "blocking" boolean NOT NULL DEFAULT true,
  "created_by" uuid NOT NULL,
  "approved_by" uuid,
  "approved_at" timestamptz,
  "rejected_reason" varchar(500),
  "applied_by" uuid,
  "applied_at" timestamptz,
  "apply_summary" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_import_sessions_status_idx" ON "media_import_sessions" ("status", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_import_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "media_import_sessions"("id") ON DELETE CASCADE,
  "row_number" integer NOT NULL,
  "filename" varchar(255) NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "asset_id" uuid REFERENCES "media_assets"("id") ON DELETE SET NULL,
  "sku_token" varchar(120),
  "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
  "product_sku" varchar(50),
  "slot" smallint,
  "role" varchar(40),
  "alt_text" varchar(255),
  "source" varchar(20) NOT NULL DEFAULT 'FILENAME',
  "status" text NOT NULL,
  "issues" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "expected_revision" integer,
  "current_map" jsonb,
  "proposed_map" jsonb,
  "apply_status" text,
  "applied_revision" integer,
  "applied_at" timestamptz,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_import_rows_session_row_uq" ON "media_import_rows" ("session_id", "row_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_import_rows_product_idx" ON "media_import_rows" ("product_id");
