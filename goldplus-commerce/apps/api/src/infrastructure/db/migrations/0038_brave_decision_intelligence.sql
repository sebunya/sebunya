CREATE TABLE IF NOT EXISTS "decision_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_type" varchar(48) NOT NULL,
	"category" varchar(20) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"policy_version" integer NOT NULL,
	"calculation_version" integer NOT NULL,
	"effective_date" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decision_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" varchar(240) NOT NULL,
	"category" varchar(20) NOT NULL,
	"signal_type" varchar(48) NOT NULL,
	"subject" varchar(120) NOT NULL,
	"subject_ref" varchar(128),
	"window_key" varchar(40) NOT NULL,
	"severity" varchar(12) NOT NULL,
	"confidence" varchar(24) NOT NULL,
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"recommendation" varchar(40) NOT NULL,
	"title" varchar(200) NOT NULL,
	"summary" text NOT NULL,
	"score" double precision NOT NULL,
	"current_value" double precision NOT NULL,
	"baseline_value" double precision NOT NULL,
	"delta" double precision NOT NULL,
	"sample_size" integer NOT NULL,
	"freshest_at" timestamp with time zone,
	"policy_version" integer NOT NULL,
	"calculation_version" integer NOT NULL,
	"source_version" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"assigned_to" uuid,
	"assigned_team" varchar(64),
	"resolution_code" varchar(32),
	"generated_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decision_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" uuid NOT NULL,
	"metric" varchar(40) NOT NULL,
	"baseline" double precision NOT NULL,
	"current_value" double precision NOT NULL,
	"delta" double precision NOT NULL,
	"current_window_days" integer NOT NULL,
	"comparison_window_days" integer NOT NULL,
	"sample_size" integer NOT NULL,
	"freshest_at" timestamp with time zone,
	"source_type" varchar(48) NOT NULL,
	"source_ref" varchar(128) NOT NULL,
	"source_version" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"calculation_version" integer NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decision_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" uuid NOT NULL,
	"recommendation_type" varchar(40) NOT NULL,
	"handoff_state" varchar(24),
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decision_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" uuid NOT NULL,
	"assigned_to" uuid,
	"assigned_team" varchar(64),
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decision_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" uuid NOT NULL,
	"event_type" varchar(40) NOT NULL,
	"actor_id" uuid,
	"from_status" varchar(16),
	"to_status" varchar(16),
	"reason" text,
	"correlation_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "decision_policies_signal_version_idx" ON "decision_policies" ("signal_type","policy_version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "decision_insights_key_idx" ON "decision_insights" ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_insights_status_idx" ON "decision_insights" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_insights_category_idx" ON "decision_insights" ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_insights_severity_idx" ON "decision_insights" ("severity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_insights_assigned_idx" ON "decision_insights" ("assigned_to");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_evidence_insight_idx" ON "decision_evidence" ("insight_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_recommendations_insight_idx" ON "decision_recommendations" ("insight_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_assignments_insight_idx" ON "decision_assignments" ("insight_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_events_insight_idx" ON "decision_events" ("insight_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decision_insights" ADD CONSTRAINT "decision_insights_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decision_evidence" ADD CONSTRAINT "decision_evidence_insight_id_decision_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "decision_insights"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decision_recommendations" ADD CONSTRAINT "decision_recommendations_insight_id_decision_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "decision_insights"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decision_assignments" ADD CONSTRAINT "decision_assignments_insight_id_decision_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "decision_insights"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decision_events" ADD CONSTRAINT "decision_events_insight_id_decision_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "decision_insights"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
