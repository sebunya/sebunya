CREATE TABLE IF NOT EXISTS "measurement_control_tower_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" text NOT NULL,
	"action" text NOT NULL,
	"section" text,
	"safe_reference_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb
);
