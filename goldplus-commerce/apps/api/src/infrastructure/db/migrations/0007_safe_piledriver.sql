CREATE TABLE IF NOT EXISTS "identity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anonymous_id" varchar(160),
	"browser_id" varchar(160),
	"session_id" varchar(160),
	"cart_id" uuid,
	"lead_id" uuid,
	"customer_id" uuid,
	"email_hash" varchar(64),
	"phone_hash" varchar(64),
	"link_type" varchar(50) NOT NULL,
	"link_confidence" integer DEFAULT 0 NOT NULL,
	"source_event_id" uuid,
	"first_linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "anonymous_id" varchar(160);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "anonymous_id" varchar(160);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "browser_id" varchar(160);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "session_id" varchar(160);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cart_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "attribution_id" uuid;--> statement-breakpoint
ALTER TABLE "dealer_applications" ADD COLUMN "anonymous_id" varchar(160);--> statement-breakpoint
ALTER TABLE "dealer_applications" ADD COLUMN "browser_id" varchar(160);--> statement-breakpoint
ALTER TABLE "dealer_applications" ADD COLUMN "session_id" varchar(160);--> statement-breakpoint
ALTER TABLE "dealer_applications" ADD COLUMN "attribution_id" uuid;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "anonymous_id" varchar(160);--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "browser_id" varchar(160);--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "session_id" varchar(160);--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "cart_id" uuid;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "attribution_id" uuid;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "rule_id" uuid;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "attribution_id" uuid;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "cart_id" uuid;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "browser_id" varchar(160);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "impression_id" uuid;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "rail_render_id" uuid;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "reason_code" varchar(80);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "applied_rule_ids" jsonb;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "source_product_id" uuid;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "page_path" varchar(255);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "referrer" varchar(500);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "utm_source" varchar(100);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "utm_medium" varchar(100);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "utm_campaign" varchar(150);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "utm_content" varchar(150);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "utm_term" varchar(150);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "device_type" varchar(50);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "browser_family" varchar(80);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "os_family" varchar(80);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "screen_width" integer;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "screen_height" integer;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "viewport_width" integer;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "viewport_height" integer;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "language" varchar(30);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "timezone" varchar(80);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "location_source" varchar(50);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "district" varchar(120);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "town" varchar(120);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "gps_geohash" varchar(16);--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN "gps_accuracy_meters" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identity_links_anonymous_idx" ON "identity_links" ("anonymous_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identity_links_browser_idx" ON "identity_links" ("browser_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identity_links_session_idx" ON "identity_links" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identity_links_cart_idx" ON "identity_links" ("cart_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identity_links_lead_idx" ON "identity_links" ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identity_links_customer_idx" ON "identity_links" ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identity_links_email_hash_idx" ON "identity_links" ("email_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identity_links_phone_hash_idx" ON "identity_links" ("phone_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carts_session_idx" ON "carts" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carts_anonymous_idx" ON "carts" ("anonymous_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_number_idx" ON "orders" ("order_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_anonymous_idx" ON "orders" ("anonymous_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_browser_idx" ON "orders" ("browser_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_session_idx" ON "orders" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_cart_idx" ON "orders" ("cart_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_attribution_idx" ON "orders" ("attribution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dealer_applications_anonymous_idx" ON "dealer_applications" ("anonymous_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dealer_applications_browser_idx" ON "dealer_applications" ("browser_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dealer_applications_session_idx" ON "dealer_applications" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dealer_applications_attribution_idx" ON "dealer_applications" ("attribution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_requests_anonymous_idx" ON "quote_requests" ("anonymous_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_requests_browser_idx" ON "quote_requests" ("browser_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_requests_session_idx" ON "quote_requests" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_requests_cart_idx" ON "quote_requests" ("cart_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_requests_attribution_idx" ON "quote_requests" ("attribution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_rule_idx" ON "recommendation_events" ("rule_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_attribution_idx" ON "recommendation_events" ("attribution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_cart_idx" ON "recommendation_events" ("cart_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_browser_idx" ON "recommendation_events" ("browser_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_lead_idx" ON "recommendation_events" ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_impression_idx" ON "recommendation_events" ("impression_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_rail_render_idx" ON "recommendation_events" ("rail_render_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_utm_source_idx" ON "recommendation_events" ("utm_source");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_rule_id_recommendation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "recommendation_rules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_source_product_id_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "products"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
