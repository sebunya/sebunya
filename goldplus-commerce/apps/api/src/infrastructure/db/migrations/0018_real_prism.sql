CREATE TABLE IF NOT EXISTS "release_decisions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"run_id" varchar(36) NOT NULL,
	"status" varchar(50) NOT NULL,
	"recorded_by" varchar(36) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "release_readiness_audit_log" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"admin_user_id" varchar(36) NOT NULL,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(100),
	"resource_id" varchar(100),
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "release_readiness_gate_results" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"run_id" varchar(36) NOT NULL,
	"gate_id" varchar(100) NOT NULL,
	"category" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(50) NOT NULL,
	"severity" varchar(50) NOT NULL,
	"evidence" jsonb DEFAULT '{}' NOT NULL,
	"source" varchar(255) NOT NULL,
	"recommendation" text,
	"safe_reference_id" varchar(255),
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" varchar(36),
	"acknowledgement_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "release_readiness_runs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"status" varchar(50) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"triggered_by" varchar(36) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "release_decisions" ADD CONSTRAINT "release_decisions_run_id_release_readiness_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "release_readiness_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "release_decisions" ADD CONSTRAINT "release_decisions_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 -- Slice 0B: this FK is varchar(36) -> uuid and has never applied anywhere
 -- (42804 on every fresh replay). Tolerating the mismatch keeps fresh installs
 -- identical to every existing environment; migration 0028 repairs the type
 -- and adds the constraint properly.
 WHEN datatype_mismatch THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "release_readiness_audit_log" ADD CONSTRAINT "release_readiness_audit_log_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 -- Slice 0B: varchar -> uuid FK never applied anywhere (42804 on every fresh
 -- replay); tolerated here, repaired properly in migration 0028.
 WHEN datatype_mismatch THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "release_readiness_gate_results" ADD CONSTRAINT "release_readiness_gate_results_run_id_release_readiness_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "release_readiness_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "release_readiness_gate_results" ADD CONSTRAINT "release_readiness_gate_results_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 -- Slice 0B: varchar -> uuid FK never applied anywhere (42804 on every fresh
 -- replay); tolerated here, repaired properly in migration 0028.
 WHEN datatype_mismatch THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "release_readiness_runs" ADD CONSTRAINT "release_readiness_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 -- Slice 0B: varchar -> uuid FK never applied anywhere (42804 on every fresh
 -- replay); tolerated here, repaired properly in migration 0028.
 WHEN datatype_mismatch THEN null;
END $$;
