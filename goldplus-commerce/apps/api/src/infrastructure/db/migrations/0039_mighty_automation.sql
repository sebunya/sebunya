CREATE TABLE IF NOT EXISTS "automation_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"status" varchar(24) DEFAULT 'DRAFT' NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"config" jsonb NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"approver_id" uuid,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"trigger_execution_key" varchar(240) NOT NULL,
	"trigger_family" varchar(32) NOT NULL,
	"trigger_event_id" varchar(128),
	"subject_id" varchar(128),
	"window_key" varchar(40) NOT NULL,
	"status" varchar(20) DEFAULT 'PLANNED' NOT NULL,
	"planned_count" integer DEFAULT 0 NOT NULL,
	"ineligible_count" integer DEFAULT 0 NOT NULL,
	"evidence" jsonb,
	"lease_owner" varchar(64),
	"lease_expires_at" timestamp with time zone,
	"attempt" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"error" text,
	"planned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_action_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"action_index" integer NOT NULL,
	"action_family" varchar(32) NOT NULL,
	"idempotency_key" varchar(260) NOT NULL,
	"status" varchar(20) DEFAULT 'PLANNED' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"last_error" text,
	"outbox_event_id" uuid,
	"dead_lettered_at" timestamp with time zone,
	"replayed_at" timestamp with time zone,
	"replay_actor" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"action_execution_id" uuid,
	"subject_id" varchar(128),
	"reason" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid,
	"version_id" uuid,
	"execution_id" uuid,
	"event_type" varchar(40) NOT NULL,
	"actor_id" uuid,
	"from_state" varchar(24),
	"to_state" varchar(24),
	"reason" text,
	"correlation_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_versions_def_version_idx" ON "automation_versions" ("definition_id","version_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_definitions_status_idx" ON "automation_definitions" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_definitions_next_run_idx" ON "automation_definitions" ("next_run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_approvals_version_idx" ON "automation_approvals" ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_executions_trigger_key_idx" ON "automation_executions" ("trigger_execution_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_executions_status_idx" ON "automation_executions" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_executions_subject_window_idx" ON "automation_executions" ("subject_id","window_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_action_executions_idem_idx" ON "automation_action_executions" ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_action_executions_execution_idx" ON "automation_action_executions" ("execution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_action_executions_status_retry_idx" ON "automation_action_executions" ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_action_executions_dead_letter_idx" ON "automation_action_executions" ("dead_lettered_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_suppressions_execution_idx" ON "automation_suppressions" ("execution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_suppressions_reason_idx" ON "automation_suppressions" ("reason");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_events_definition_idx" ON "automation_events" ("definition_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_events_execution_idx" ON "automation_events" ("execution_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_definition_id_automation_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "automation_definitions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_approvals" ADD CONSTRAINT "automation_approvals_version_id_automation_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "automation_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_version_id_automation_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "automation_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_action_executions" ADD CONSTRAINT "automation_action_executions_execution_id_automation_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "automation_executions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_suppressions" ADD CONSTRAINT "automation_suppressions_execution_id_automation_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "automation_executions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
