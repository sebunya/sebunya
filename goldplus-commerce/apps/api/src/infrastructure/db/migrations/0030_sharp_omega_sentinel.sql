ALTER TABLE "fulfilment_tasks" ADD COLUMN "priority" varchar(10) DEFAULT 'normal' NOT NULL;--> statement-breakpoint
-- Upgrade-safe: add nullable, backfill existing rows to the deterministic normal
-- SLA window (created_at + 24h), then enforce NOT NULL. New rows always set it.
ALTER TABLE "fulfilment_tasks" ADD COLUMN "sla_due_at" timestamp with time zone;--> statement-breakpoint
UPDATE "fulfilment_tasks" SET "sla_due_at" = "created_at" + interval '24 hours' WHERE "sla_due_at" IS NULL;--> statement-breakpoint
ALTER TABLE "fulfilment_tasks" ALTER COLUMN "sla_due_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fulfilment_tasks" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfilment_tasks_assigned_idx" ON "fulfilment_tasks" ("assigned_to");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfilment_tasks_sla_idx" ON "fulfilment_tasks" ("sla_due_at");