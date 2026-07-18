CREATE TABLE IF NOT EXISTS "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"requested_quantity" integer NOT NULL,
	"reserved_quantity" integer NOT NULL,
	"status" varchar(20) DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reserved_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reorder_point" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_reservations_order_product_idx" ON "inventory_reservations" ("order_id","product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_reservations_order_idx" ON "inventory_reservations" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_reservations_product_idx" ON "inventory_reservations" ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_reservations_status_idx" ON "inventory_reservations" ("status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
