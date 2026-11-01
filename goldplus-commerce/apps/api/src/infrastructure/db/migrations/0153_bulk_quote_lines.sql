-- 0153: bulk quote requests carry their lines (docs/bulk-buying/DESIGN.md).
--
-- A bulk buyer builds a list of many products with a quantity each at /bulk
-- and sends it as one quote request. quote_requests held one free-text product
-- and one free-text quantity, so it gains header columns and a child table of
-- lines. Each line's name, code, list price and availability are SNAPSHOTS the
-- API took from the public catalogue at request time (never a client price).
--
-- Additive and backward compatible: every new quote_requests column is NULLABLE
-- or has a default, so the legacy /quote-request form and every existing reader
-- keep working unchanged, and old rows simply have no reference and no lines.
-- Old code ignores all of it.
--
-- Rollback: DROP TABLE quote_request_lines; ALTER TABLE quote_requests
--   DROP COLUMN reference, DROP COLUMN idempotency_key, DROP COLUMN
--   request_fingerprint, DROP COLUMN source, DROP COLUMN buyer_type, DROP COLUMN
--   business_name, DROP COLUMN delivery_district, DROP COLUMN needed_by,
--   DROP COLUMN line_count, DROP COLUMN total_units, DROP COLUMN
--   estimated_total_ugx, DROP COLUMN priced_line_count, DROP COLUMN updated_at;
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "reference" varchar(16);
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(80);
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "request_fingerprint" varchar(64);
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "source" varchar(24) DEFAULT 'form' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "buyer_type" varchar(20);
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "business_name" varchar(160);
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "delivery_district" varchar(80);
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "needed_by" date;
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "line_count" integer;
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "total_units" integer;
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "estimated_total_ugx" bigint;
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "priced_line_count" integer;
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz;
--> statement-breakpoint
-- Unique only where set: legacy rows keep NULL, and Postgres never treats two
-- NULLs as equal, so a plain unique index is safe on the existing data.
CREATE UNIQUE INDEX IF NOT EXISTS "quote_requests_reference_uq" ON "quote_requests" ("reference");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quote_requests_idempotency_key_uq" ON "quote_requests" ("idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_request_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_request_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "product_id" uuid,
  "product_code" varchar(120),
  "product_name" varchar(255) NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price_ugx" bigint,
  "line_total_ugx" bigint,
  "availability" varchar(16) DEFAULT 'unknown' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "quote_request_lines_request_fk" FOREIGN KEY ("quote_request_id") REFERENCES "quote_requests"("id") ON DELETE CASCADE,
  -- The snapshot outlives the product: a deleted product leaves the line's name, code and price.
  CONSTRAINT "quote_request_lines_product_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL,
  CONSTRAINT "quote_request_lines_quantity_chk" CHECK ("quantity" > 0 AND "quantity" <= 50000),
  CONSTRAINT "quote_request_lines_price_chk" CHECK ("unit_price_ugx" IS NULL OR "unit_price_ugx" >= 0),
  CONSTRAINT "quote_request_lines_line_no_chk" CHECK ("line_no" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_request_lines_request_idx" ON "quote_request_lines" ("quote_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quote_request_lines_line_no_uq" ON "quote_request_lines" ("quote_request_id", "line_no");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quote_request_lines_product_uq" ON "quote_request_lines" ("quote_request_id", "product_id");
