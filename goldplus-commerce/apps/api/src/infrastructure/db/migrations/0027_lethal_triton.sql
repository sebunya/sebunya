ALTER TABLE "support_issues" ADD COLUMN "assigned_to" varchar(120);--> statement-breakpoint
ALTER TABLE "support_issues" ADD COLUMN "updated_at" timestamp with time zone;