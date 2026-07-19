CREATE TABLE IF NOT EXISTS "fulfilment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfilment_task_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" varchar(50) NOT NULL,
	"ordered_quantity" integer NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"packed_quantity" integer DEFAULT 0 NOT NULL,
	"backordered_quantity" integer DEFAULT 0 NOT NULL,
	"cancelled_quantity" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "packing_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfilment_task_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'NOT_STARTED' NOT NULL,
	"packer_user_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"package_count" integer,
	"package_reference" varchar(120),
	"packing_notes" text,
	"exception_reason" text,
	"idempotency_key" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fulfilment_lines_task_item_idx" ON "fulfilment_lines" ("fulfilment_task_id","order_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfilment_lines_task_idx" ON "fulfilment_lines" ("fulfilment_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "packing_sessions_task_idx" ON "packing_sessions" ("fulfilment_task_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fulfilment_lines" ADD CONSTRAINT "fulfilment_lines_fulfilment_task_id_fulfilment_tasks_id_fk" FOREIGN KEY ("fulfilment_task_id") REFERENCES "fulfilment_tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "packing_sessions" ADD CONSTRAINT "packing_sessions_fulfilment_task_id_fulfilment_tasks_id_fk" FOREIGN KEY ("fulfilment_task_id") REFERENCES "fulfilment_tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "packing_sessions" ADD CONSTRAINT "packing_sessions_packer_user_id_users_id_fk" FOREIGN KEY ("packer_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
