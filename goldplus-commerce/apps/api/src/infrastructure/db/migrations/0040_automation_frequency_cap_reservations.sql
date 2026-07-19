CREATE TABLE IF NOT EXISTS "automation_frequency_cap_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"subject_scope" varchar(140) NOT NULL,
	"window_key" varchar(40) NOT NULL,
	"limit_snapshot" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_frequency_cap_reservations_execution_idx" ON "automation_frequency_cap_reservations" ("execution_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_frequency_cap_reservations_scope_window_idx" ON "automation_frequency_cap_reservations" ("version_id", "subject_scope", "window_key");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_frequency_cap_reservations" ADD CONSTRAINT "automation_cap_reservation_execution_fk" FOREIGN KEY ("execution_id") REFERENCES "automation_executions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_frequency_cap_reservations" ADD CONSTRAINT "automation_cap_reservation_definition_fk" FOREIGN KEY ("definition_id") REFERENCES "automation_definitions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_frequency_cap_reservations" ADD CONSTRAINT "automation_cap_reservation_version_fk" FOREIGN KEY ("version_id") REFERENCES "automation_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
