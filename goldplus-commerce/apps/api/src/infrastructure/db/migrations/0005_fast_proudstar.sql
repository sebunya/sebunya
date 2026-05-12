CREATE TABLE IF NOT EXISTS "recommendation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"anonymous_id" varchar(160),
	"customer_id" uuid,
	"session_id" varchar(160),
	"product_id" uuid,
	"category_id" uuid,
	"search_query" text,
	"placement" varchar(80),
	"recommendation_product_id" uuid,
	"source" varchar(160),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_event_type_idx" ON "recommendation_events" ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_anonymous_id_idx" ON "recommendation_events" ("anonymous_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_customer_id_idx" ON "recommendation_events" ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_product_id_idx" ON "recommendation_events" ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_category_id_idx" ON "recommendation_events" ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_placement_idx" ON "recommendation_events" ("placement");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_created_at_idx" ON "recommendation_events" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_product_created_at_idx" ON "recommendation_events" ("product_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_type_created_at_idx" ON "recommendation_events" ("event_type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_anonymous_created_at_idx" ON "recommendation_events" ("anonymous_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_recommendation_product_created_at_idx" ON "recommendation_events" ("recommendation_product_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_recommendation_product_id_products_id_fk" FOREIGN KEY ("recommendation_product_id") REFERENCES "products"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
