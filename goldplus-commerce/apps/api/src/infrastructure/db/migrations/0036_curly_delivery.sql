CREATE TABLE IF NOT EXISTS "fulfilment_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfilment_task_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"outcome" varchar(30) NOT NULL,
	"delivered_at" timestamp with time zone,
	"recipient_name_masked" varchar(60),
	"recipient_confirmation" varchar(120),
	"proof_reference" varchar(120),
	"failed_reason" text,
	"rescheduled_for" timestamp with time zone,
	"delivered_quantity" integer DEFAULT 0 NOT NULL,
	"returned_quantity" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fulfilment_deliveries_task_attempt_idx" ON "fulfilment_deliveries" ("fulfilment_task_id","attempt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfilment_deliveries_order_idx" ON "fulfilment_deliveries" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfilment_deliveries_outcome_idx" ON "fulfilment_deliveries" ("outcome");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fulfilment_deliveries" ADD CONSTRAINT "fulfilment_deliveries_fulfilment_task_id_fulfilment_tasks_id_fk" FOREIGN KEY ("fulfilment_task_id") REFERENCES "fulfilment_tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fulfilment_deliveries" ADD CONSTRAINT "fulfilment_deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
