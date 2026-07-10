CREATE TABLE IF NOT EXISTS "controlled_activation_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"activation_request_id" text NOT NULL,
	"approver_admin_id" text NOT NULL,
	"approval_status" text NOT NULL,
	"approval_note" text NOT NULL,
	"approved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_activation_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"activation_request_id" text NOT NULL,
	"actor_admin_id" text NOT NULL,
	"action" text NOT NULL,
	"safe_payload" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_activation_gate_results" (
	"gate_id" text PRIMARY KEY NOT NULL,
	"activation_request_id" text NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"severity" text NOT NULL,
	"evidence_summary" text NOT NULL,
	"safe_reference_id" text,
	"checked_at" timestamp NOT NULL,
	"blocker_reason" text,
	"recommendation" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_activation_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"requested_by_admin_id" text NOT NULL,
	"requested_at" timestamp NOT NULL,
	"activation_name" text NOT NULL,
	"activation_scope" text NOT NULL,
	"environment" text NOT NULL,
	"requested_window_start" timestamp,
	"requested_window_end" timestamp,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"canary_scope" text,
	"rollback_plan_summary" text,
	"monitoring_owner" text,
	"stakeholder_approver" text,
	"risk_level" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_approvals" ADD CONSTRAINT "controlled_activation_approvals_activation_request_id_controlled_activation_requests_id_fk" FOREIGN KEY ("activation_request_id") REFERENCES "controlled_activation_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_audit_log" ADD CONSTRAINT "controlled_activation_audit_log_activation_request_id_controlled_activation_requests_id_fk" FOREIGN KEY ("activation_request_id") REFERENCES "controlled_activation_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_activation_gate_results" ADD CONSTRAINT "controlled_activation_gate_results_activation_request_id_controlled_activation_requests_id_fk" FOREIGN KEY ("activation_request_id") REFERENCES "controlled_activation_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
