ALTER TABLE "outbox_events" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;