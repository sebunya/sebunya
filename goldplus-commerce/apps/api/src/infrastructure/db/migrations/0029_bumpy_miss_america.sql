CREATE TABLE IF NOT EXISTS "fulfilment_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_number" varchar(20) NOT NULL,
	"status" varchar(30) DEFAULT 'NEW' NOT NULL,
	"payment_status" varchar(30) NOT NULL,
	"payment_method" varchar(40),
	"customer_name" varchar(255) NOT NULL,
	"customer_contact_masked" varchar(80) NOT NULL,
	"delivery_area" varchar(255) NOT NULL,
	"delivery_summary" text NOT NULL,
	"total_ugx" integer NOT NULL,
	"delivery_fee_ugx" integer DEFAULT 0 NOT NULL,
	"item_count" integer NOT NULL,
	"items" jsonb NOT NULL,
	"warnings" jsonb,
	"assigned_to" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fulfilment_tasks_order_id_idx" ON "fulfilment_tasks" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfilment_tasks_status_idx" ON "fulfilment_tasks" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfilment_tasks_created_idx" ON "fulfilment_tasks" ("created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fulfilment_tasks" ADD CONSTRAINT "fulfilment_tasks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fulfilment_tasks" ADD CONSTRAINT "fulfilment_tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
