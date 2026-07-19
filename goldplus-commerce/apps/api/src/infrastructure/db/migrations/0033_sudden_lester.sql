CREATE TABLE IF NOT EXISTS "fulfilment_sla_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"stage" varchar(20) NOT NULL,
	"policy_version" integer NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"team_id" uuid,
	"assignee_id" uuid,
	"due_at_snapshot" timestamp with time zone NOT NULL,
	"priority_snapshot" varchar(10) NOT NULL,
	"detail" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fulfilment_tasks" ADD COLUMN "sla_policy_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "fulfilment_team_members" ADD COLUMN "is_lead" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fulfilment_sla_events_key_idx" ON "fulfilment_sla_events" ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfilment_sla_events_task_idx" ON "fulfilment_sla_events" ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfilment_sla_events_stage_idx" ON "fulfilment_sla_events" ("stage");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fulfilment_sla_events" ADD CONSTRAINT "fulfilment_sla_events_task_id_fulfilment_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "fulfilment_tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
