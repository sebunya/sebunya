CREATE TABLE IF NOT EXISTS "fulfilment_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfilment_task_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"dispatch_reference" varchar(80) NOT NULL,
	"method" varchar(20) NOT NULL,
	"carrier_name" varchar(120),
	"rider_name" varchar(120),
	"contact_masked" varchar(40),
	"payment_policy" varchar(20) NOT NULL,
	"tracking_status" varchar(20) DEFAULT 'DISPATCHED' NOT NULL,
	"stock_consumed" boolean DEFAULT false NOT NULL,
	"dispatch_time" timestamp with time zone NOT NULL,
	"estimated_delivery_at" timestamp with time zone,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fulfilment_dispatches_task_idx" ON "fulfilment_dispatches" ("fulfilment_task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfilment_dispatches_order_idx" ON "fulfilment_dispatches" ("order_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fulfilment_dispatches" ADD CONSTRAINT "fulfilment_dispatches_fulfilment_task_id_fulfilment_tasks_id_fk" FOREIGN KEY ("fulfilment_task_id") REFERENCES "fulfilment_tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fulfilment_dispatches" ADD CONSTRAINT "fulfilment_dispatches_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
