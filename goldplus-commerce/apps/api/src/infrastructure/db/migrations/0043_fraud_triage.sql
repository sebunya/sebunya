CREATE TABLE IF NOT EXISTS "fraud_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reference_key" varchar(160) NOT NULL,
  "source_type" varchar(20) NOT NULL,
  "source_ref" varchar(160) NOT NULL,
  "subject_ref_hash" varchar(64),
  "status" varchar(20) DEFAULT 'OPEN' NOT NULL,
  "priority" varchar(20) DEFAULT 'LOW' NOT NULL,
  "assigned_to" uuid,
  "version" integer DEFAULT 1 NOT NULL,
  "final_decision" varchar(20),
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fraud_cases_source_type_check" CHECK ("source_type" IN ('CHECKOUT','ORDER','PAYMENT','IDENTITY')),
  CONSTRAINT "fraud_cases_status_check" CHECK ("status" IN ('OPEN','IN_REVIEW','RESOLVED')),
  CONSTRAINT "fraud_cases_priority_check" CHECK ("priority" IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT "fraud_cases_decision_check" CHECK ("final_decision" IS NULL OR "final_decision" IN ('ALLOW','HOLD','DECLINE')),
  CONSTRAINT "fraud_cases_resolution_check" CHECK (("status" = 'RESOLVED' AND "resolved_at" IS NOT NULL AND "final_decision" IS NOT NULL) OR ("status" <> 'RESOLVED' AND "resolved_at" IS NULL AND "final_decision" IS NULL)),
  CONSTRAINT "fraud_cases_version_check" CHECK ("version" > 0),
  CONSTRAINT "fraud_cases_subject_hash_check" CHECK ("subject_ref_hash" IS NULL OR "subject_ref_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fraud_cases_reference_idx" ON "fraud_cases" ("reference_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fraud_cases_queue_idx" ON "fraud_cases" ("status", "priority", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fraud_cases_assignee_idx" ON "fraud_cases" ("assigned_to", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fraud_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL REFERENCES "fraud_cases"("id"),
  "signal_key" varchar(160) NOT NULL,
  "signal_type" varchar(80) NOT NULL,
  "severity" varchar(20) NOT NULL,
  "reason_code" varchar(80) NOT NULL,
  "evidence" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fraud_signals_severity_check" CHECK ("severity" IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT "fraud_signals_evidence_check" CHECK (jsonb_typeof("evidence") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fraud_signals_case_key_idx" ON "fraud_signals" ("case_id", "signal_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fraud_signals_case_idx" ON "fraud_signals" ("case_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fraud_case_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL REFERENCES "fraud_cases"("id"),
  "action" varchar(40) NOT NULL,
  "actor_id" uuid,
  "reason" text NOT NULL,
  "evidence" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fraud_case_events_action_check" CHECK ("action" IN ('SIGNAL_RECORDED','ASSIGNED','REVIEWED','ALLOWED','HELD','DECLINED')),
  CONSTRAINT "fraud_case_events_reason_check" CHECK (length(trim("reason")) > 0),
  CONSTRAINT "fraud_case_events_evidence_check" CHECK (jsonb_typeof("evidence") = 'object')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fraud_case_events_case_idx" ON "fraud_case_events" ("case_id", "created_at");
