CREATE TABLE IF NOT EXISTS "controlled_activation_canary_runbooks" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"candidate_id" varchar(36) NOT NULL,
	"canary_scope_summary" text NOT NULL,
	"percentage_cap" integer NOT NULL,
	"max_audience_size" integer NOT NULL,
	"included_segments" jsonb NOT NULL,
	"excluded_segments" jsonb NOT NULL,
	"start_criteria" text NOT NULL,
	"pause_criteria" text NOT NULL,
	"rollback_criteria" text NOT NULL,
	"success_criteria" text NOT NULL,
	"failure_criteria" text NOT NULL,
	"monitoring_cadence" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_activation_incident_plans" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"candidate_id" varchar(36) NOT NULL,
	"incident_owner" varchar(255) NOT NULL,
	"escalation_path" text NOT NULL,
	"rollback_owner" varchar(255) NOT NULL,
	"pause_criteria" text NOT NULL,
	"rollback_criteria" text NOT NULL,
	"communication_plan" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_activation_live_readiness_checks" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"candidate_id" varchar(36) NOT NULL,
	"gate_id" varchar(100) NOT NULL,
	"status" varchar(50) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"evidence_summary" text NOT NULL,
	"blocker_reason" text,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_activation_live_review_candidates" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"activation_request_id" varchar(36) NOT NULL,
	"execution_plan_id" varchar(36) NOT NULL,
	"dry_run_id" varchar(36) NOT NULL,
	"evidence_pack_id" varchar(36) NOT NULL,
	"created_by_admin_id" varchar(255) NOT NULL,
	"status" varchar(50) NOT NULL,
	"environment" varchar(50) NOT NULL,
	"activation_window_start" timestamp NOT NULL,
	"activation_window_end" timestamp NOT NULL,
	"canary_scope_summary" text NOT NULL,
	"monitoring_owner" varchar(255) NOT NULL,
	"incident_owner" varchar(255) NOT NULL,
	"rollback_owner" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_activation_operator_checklists" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"candidate_id" varchar(36) NOT NULL,
	"operator_admin_id" varchar(255) NOT NULL,
	"checklist_status" varchar(50) NOT NULL,
	"items" jsonb NOT NULL,
	"acknowledged_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_activation_stakeholder_live_approvals" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"candidate_id" varchar(36) NOT NULL,
	"approver_admin_id" varchar(255) NOT NULL,
	"approval_status" varchar(50) NOT NULL,
	"approval_note" text NOT NULL,
	"approved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_canary_runbooks" ADD CONSTRAINT "controlled_activation_canary_runbooks_candidate_id_controlled_activation_live_review_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "controlled_activation_live_review_candidates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_incident_plans" ADD CONSTRAINT "controlled_activation_incident_plans_candidate_id_controlled_activation_live_review_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "controlled_activation_live_review_candidates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_live_readiness_checks" ADD CONSTRAINT "controlled_activation_live_readiness_checks_candidate_id_controlled_activation_live_review_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "controlled_activation_live_review_candidates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_live_review_candidates" ADD CONSTRAINT "controlled_activation_live_review_candidates_activation_request_id_controlled_activation_requests_id_fk" FOREIGN KEY ("activation_request_id") REFERENCES "controlled_activation_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_live_review_candidates" ADD CONSTRAINT "controlled_activation_live_review_candidates_execution_plan_id_controlled_activation_execution_plans_id_fk" FOREIGN KEY ("execution_plan_id") REFERENCES "controlled_activation_execution_plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_operator_checklists" ADD CONSTRAINT "controlled_activation_operator_checklists_candidate_id_controlled_activation_live_review_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "controlled_activation_live_review_candidates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_stakeholder_live_approvals" ADD CONSTRAINT "controlled_activation_stakeholder_live_approvals_candidate_id_controlled_activation_live_review_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "controlled_activation_live_review_candidates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
