ALTER TABLE "outbox_events" ADD COLUMN "idempotency_key" varchar(255);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "channel" varchar(50);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "template" varchar(100);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "status" varchar(30) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "related_entity" varchar(50);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "related_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dry_run_only" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "preview_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "no_send_guarantee" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "suppressed_reason" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_idempotency_key_unique" UNIQUE("idempotency_key");