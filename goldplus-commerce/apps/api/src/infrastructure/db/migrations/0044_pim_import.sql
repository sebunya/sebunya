CREATE TABLE IF NOT EXISTS "pim_import_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "name" varchar(160) NOT NULL, "source_filename" varchar(255) NOT NULL, "source_sha256" varchar(64) NOT NULL,
  "mode" varchar(20) NOT NULL, "status" varchar(30) DEFAULT 'UPLOADED' NOT NULL, "version" integer DEFAULT 1 NOT NULL, "mapping" jsonb,
  "total_rows" integer NOT NULL, "valid_rows" integer DEFAULT 0 NOT NULL, "invalid_rows" integer DEFAULT 0 NOT NULL, "create_rows" integer DEFAULT 0 NOT NULL, "update_rows" integer DEFAULT 0 NOT NULL, "applied_rows" integer DEFAULT 0 NOT NULL, "failed_rows" integer DEFAULT 0 NOT NULL, "preview_digest" varchar(64),
  "created_by" uuid NOT NULL, "approved_by" uuid, "approved_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pim_import_sessions_mode_check" CHECK ("mode" IN ('CREATE_ONLY','UPSERT')),
  CONSTRAINT "pim_import_sessions_status_check" CHECK ("status" IN ('UPLOADED','MAPPED','READY_FOR_APPROVAL','APPROVED','APPLYING','APPLIED','PARTIALLY_APPLIED','FAILED','ROLLED_BACK','ROLLBACK_PARTIAL','REJECTED')),
  CONSTRAINT "pim_import_sessions_counts_check" CHECK ("total_rows" BETWEEN 1 AND 1000 AND "valid_rows" >= 0 AND "invalid_rows" >= 0 AND "create_rows" >= 0 AND "update_rows" >= 0 AND "applied_rows" >= 0 AND "failed_rows" >= 0),
  CONSTRAINT "pim_import_sessions_hash_check" CHECK ("source_sha256" ~ '^[a-f0-9]{64}$' AND ("preview_digest" IS NULL OR "preview_digest" ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pim_import_sessions_source_idx" ON "pim_import_sessions" ("source_sha256");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pim_import_sessions_status_idx" ON "pim_import_sessions" ("status", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pim_import_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "session_id" uuid NOT NULL REFERENCES "pim_import_sessions"("id"), "row_number" integer NOT NULL,
  "source_data" jsonb NOT NULL, "normalized_data" jsonb, "validation_errors" jsonb NOT NULL, "action" varchar(20) DEFAULT 'PENDING' NOT NULL, "status" varchar(20) DEFAULT 'PENDING' NOT NULL,
  "target_product_id" uuid, "before_snapshot" jsonb, "after_snapshot" jsonb, "error" text,
  CONSTRAINT "pim_import_rows_number_check" CHECK ("row_number" > 0),
  CONSTRAINT "pim_import_rows_action_check" CHECK ("action" IN ('PENDING','CREATE','UPDATE','SKIP')),
  CONSTRAINT "pim_import_rows_status_check" CHECK ("status" IN ('PENDING','VALID','INVALID','APPLIED','FAILED','ROLLED_BACK')),
  CONSTRAINT "pim_import_rows_json_check" CHECK (jsonb_typeof("source_data")='object' AND jsonb_typeof("validation_errors")='array' AND ("normalized_data" IS NULL OR jsonb_typeof("normalized_data")='object'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pim_import_rows_session_row_idx" ON "pim_import_rows" ("session_id", "row_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pim_import_rows_status_idx" ON "pim_import_rows" ("session_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pim_import_approvals" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "session_id" uuid NOT NULL REFERENCES "pim_import_sessions"("id"), "decision" varchar(20) NOT NULL, "actor_id" uuid NOT NULL, "reason" text NOT NULL, "preview_digest" varchar(64) NOT NULL, "decided_at" timestamp with time zone DEFAULT now() NOT NULL, CONSTRAINT "pim_import_approvals_decision_check" CHECK ("decision" IN ('APPROVED','REJECTED')), CONSTRAINT "pim_import_approvals_reason_check" CHECK (length(trim("reason")) > 0));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pim_import_approvals_session_idx" ON "pim_import_approvals" ("session_id", "decided_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pim_import_events" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "session_id" uuid NOT NULL REFERENCES "pim_import_sessions"("id"), "action" varchar(40) NOT NULL, "actor_id" uuid NOT NULL, "reason" text NOT NULL, "evidence" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, CONSTRAINT "pim_import_events_reason_check" CHECK (length(trim("reason")) > 0), CONSTRAINT "pim_import_events_evidence_check" CHECK (jsonb_typeof("evidence")='object'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pim_import_events_session_idx" ON "pim_import_events" ("session_id", "created_at");
