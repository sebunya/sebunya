CREATE TABLE IF NOT EXISTS "controlled_activation_canary_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_plan_id" text NOT NULL,
	"scope_summary" text NOT NULL,
	"max_audience_size" integer NOT NULL,
	"percentage_cap" integer NOT NULL,
	"included_segments" jsonb NOT NULL,
	"excluded_segments" jsonb NOT NULL,
	"risk_level" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_activation_destination_previews" (
	"id" text PRIMARY KEY NOT NULL,
	"dry_run_id" text NOT NULL,
	"destination" text NOT NULL,
	"event_type" text NOT NULL,
	"consent_status" text NOT NULL,
	"routing_decision" text NOT NULL,
	"status" text NOT NULL,
	"redacted_payload" jsonb,
	"blocked_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_activation_dry_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_plan_id" text NOT NULL,
	"activation_request_id" text NOT NULL,
	"started_by_admin_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"summary" text,
	"blocker_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"redacted_evidence_ref" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_activation_evidence_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"dry_run_id" text NOT NULL,
	"activation_request_id" text NOT NULL,
	"summary" text NOT NULL,
	"gate_summary" text NOT NULL,
	"payload_preview_summary" text NOT NULL,
	"consent_summary" text NOT NULL,
	"canary_summary" text NOT NULL,
	"rollback_summary" text NOT NULL,
	"monitoring_summary" text NOT NULL,
	"redacted_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_activation_execution_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"activation_request_id" text NOT NULL,
	"created_by_admin_id" text NOT NULL,
	"status" text NOT NULL,
	"activation_scope" text NOT NULL,
	"environment" text NOT NULL,
	"requested_window_start" timestamp,
	"requested_window_end" timestamp,
	"canary_scope_summary" text,
	"rollback_plan_summary" text,
	"monitoring_owner" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_canary_plans" ADD CONSTRAINT "controlled_activation_canary_plans_execution_plan_id_controlled_activation_execution_plans_id_fk" FOREIGN KEY ("execution_plan_id") REFERENCES "controlled_activation_execution_plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_destination_previews" ADD CONSTRAINT "controlled_activation_destination_previews_dry_run_id_controlled_activation_dry_runs_id_fk" FOREIGN KEY ("dry_run_id") REFERENCES "controlled_activation_dry_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_dry_runs" ADD CONSTRAINT "controlled_activation_dry_runs_execution_plan_id_controlled_activation_execution_plans_id_fk" FOREIGN KEY ("execution_plan_id") REFERENCES "controlled_activation_execution_plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_dry_runs" ADD CONSTRAINT "controlled_activation_dry_runs_activation_request_id_controlled_activation_requests_id_fk" FOREIGN KEY ("activation_request_id") REFERENCES "controlled_activation_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_evidence_packs" ADD CONSTRAINT "controlled_activation_evidence_packs_dry_run_id_controlled_activation_dry_runs_id_fk" FOREIGN KEY ("dry_run_id") REFERENCES "controlled_activation_dry_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_evidence_packs" ADD CONSTRAINT "controlled_activation_evidence_packs_activation_request_id_controlled_activation_requests_id_fk" FOREIGN KEY ("activation_request_id") REFERENCES "controlled_activation_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_execution_plans" ADD CONSTRAINT "controlled_activation_execution_plans_activation_request_id_controlled_activation_requests_id_fk" FOREIGN KEY ("activation_request_id") REFERENCES "controlled_activation_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
