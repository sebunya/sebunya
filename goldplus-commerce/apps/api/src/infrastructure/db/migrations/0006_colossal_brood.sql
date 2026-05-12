CREATE TABLE IF NOT EXISTS "recommendation_rule_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid,
	"action" varchar(80) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"performed_by" uuid,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recommendation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" varchar(80) NOT NULL,
	"status" varchar(50) DEFAULT 'DRAFT' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"placement" varchar(80) NOT NULL,
	"target_type" varchar(80) NOT NULL,
	"target_value" varchar(255),
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rule_audit_logs_rule_id_idx" ON "recommendation_rule_audit_logs" ("rule_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rule_audit_logs_action_idx" ON "recommendation_rule_audit_logs" ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rule_audit_logs_performed_by_idx" ON "recommendation_rule_audit_logs" ("performed_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rule_audit_logs_performed_at_idx" ON "recommendation_rule_audit_logs" ("performed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rules_status_idx" ON "recommendation_rules" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rules_type_idx" ON "recommendation_rules" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rules_placement_idx" ON "recommendation_rules" ("placement");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rules_target_type_idx" ON "recommendation_rules" ("target_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rules_target_value_idx" ON "recommendation_rules" ("target_value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rules_priority_idx" ON "recommendation_rules" ("priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rules_starts_at_idx" ON "recommendation_rules" ("starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rules_ends_at_idx" ON "recommendation_rules" ("ends_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rules_placement_status_idx" ON "recommendation_rules" ("placement","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rules_placement_status_priority_idx" ON "recommendation_rules" ("placement","status","priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rules_target_type_value_idx" ON "recommendation_rules" ("target_type","target_value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_rules_created_at_idx" ON "recommendation_rules" ("created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recommendation_rule_audit_logs" ADD CONSTRAINT "recommendation_rule_audit_logs_rule_id_recommendation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "recommendation_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
