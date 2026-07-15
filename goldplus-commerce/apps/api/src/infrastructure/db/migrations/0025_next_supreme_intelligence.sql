CREATE TABLE IF NOT EXISTS "product_compatibility_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"target_product_id" uuid NOT NULL,
	"verdict" varchar(20) NOT NULL,
	"note" varchar(300),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "compat_pair_idx" ON "product_compatibility_mappings" ("product_id","target_product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compat_product_idx" ON "product_compatibility_mappings" ("product_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_compatibility_mappings" ADD CONSTRAINT "product_compatibility_mappings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_compatibility_mappings" ADD CONSTRAINT "product_compatibility_mappings_target_product_id_products_id_fk" FOREIGN KEY ("target_product_id") REFERENCES "products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
