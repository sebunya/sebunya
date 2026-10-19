-- 0195: bulk buying by the carton, at dealer price, behind a verified phone
-- (docs/bulk-buying/DESIGN.md, section 12; owner decisions 2026-10-19).
--
-- WHAT
-- 1. Every product says how it is bought in bulk: by the CARTON (units_per_carton
--    pieces each; NULL = size not entered yet, the team confirms it) or by the
--    PIECE (flash drives and memory cards). The dealer price stays where it was,
--    product_prices.dealer_price, per piece.
-- 2. A bulk line records what the buyer chose (cartons or pieces) and the carton
--    size at that moment. quantity stays the total in pieces, and is NULL when
--    the carton size was not known. above_self_serve marks a line over 500
--    cartons: allowed, the team confirms supply.
-- 3. A request may carry a budget, and records whether the buyer was shown
--    dealer prices (a phone verified by SMS code).
-- 4. bulk_price_access holds the SMS code challenges and first visits (the
--    first use of a number needs no code); a verified row is also the record
--    of who looked at dealer prices.
--
-- Additive: every new column is nullable or defaulted, so the running code keeps
-- working on the migrated database. The quantity check is widened (500+ cartons
-- of a large carton can pass 50,000 pieces) and the NOT NULL dropped; old rows
-- satisfy both.
--
-- MIGRATION_REQUIRED=true. LOCK RISK: column adds with constant defaults on
-- small tables (products ~200 rows, quote lines tens of rows); instantaneous.
--
-- Rollback: DROP TABLE bulk_price_access; ALTER TABLE quote_requests DROP COLUMN
--   budget_ugx, DROP COLUMN prices_shown; ALTER TABLE quote_request_lines DROP
--   COLUMN unit_kind, DROP COLUMN unit_count, DROP COLUMN units_per_carton, DROP
--   COLUMN price_basis, DROP COLUMN above_self_serve; (restore the 0153 quantity
--   check and NOT NULL only if no line has a NULL quantity); ALTER TABLE products
--   DROP COLUMN bulk_unit, DROP COLUMN units_per_carton.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "bulk_unit" varchar(8) DEFAULT 'carton' NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "units_per_carton" integer;
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_bulk_unit_chk";
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_bulk_unit_chk" CHECK ("bulk_unit" IN ('carton', 'piece'));
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_units_per_carton_chk";
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_units_per_carton_chk" CHECK ("units_per_carton" IS NULL OR ("units_per_carton" >= 2 AND "units_per_carton" <= 10000));
--> statement-breakpoint
-- Owner: flash drives and memory cards are not bought as boxes. By name, which
-- is exact in this catalogue (19 products); card readers stay by the carton.
UPDATE "products" SET "bulk_unit" = 'piece' WHERE "name" ~* '(flash drive|memory card)' AND "bulk_unit" <> 'piece';
--> statement-breakpoint
ALTER TABLE "product_prices" DROP CONSTRAINT IF EXISTS "product_prices_dealer_price_chk";
--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_dealer_price_chk" CHECK ("dealer_price" IS NULL OR "dealer_price" > 0);
--> statement-breakpoint
ALTER TABLE "quote_request_lines" ADD COLUMN IF NOT EXISTS "unit_kind" varchar(8) DEFAULT 'piece' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote_request_lines" ADD COLUMN IF NOT EXISTS "unit_count" integer;
--> statement-breakpoint
ALTER TABLE "quote_request_lines" ADD COLUMN IF NOT EXISTS "units_per_carton" integer;
--> statement-breakpoint
ALTER TABLE "quote_request_lines" ADD COLUMN IF NOT EXISTS "price_basis" varchar(8) DEFAULT 'list' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote_request_lines" ADD COLUMN IF NOT EXISTS "above_self_serve" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote_request_lines" ALTER COLUMN "quantity" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote_request_lines" DROP CONSTRAINT IF EXISTS "quote_request_lines_quantity_chk";
--> statement-breakpoint
ALTER TABLE "quote_request_lines" ADD CONSTRAINT "quote_request_lines_quantity_chk" CHECK ("quantity" IS NULL OR ("quantity" > 0 AND "quantity" <= 100000000));
--> statement-breakpoint
ALTER TABLE "quote_request_lines" DROP CONSTRAINT IF EXISTS "quote_request_lines_unit_chk";
--> statement-breakpoint
ALTER TABLE "quote_request_lines" ADD CONSTRAINT "quote_request_lines_unit_chk" CHECK ("unit_kind" IN ('carton', 'piece') AND "price_basis" IN ('list', 'dealer') AND ("unit_count" IS NULL OR "unit_count" > 0));
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "budget_ugx" bigint;
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "prices_shown" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "quote_requests" ALTER COLUMN "total_units" TYPE bigint;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bulk_price_access" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "phone" varchar(20) NOT NULL,
  -- Keyed HMAC of the six-digit code (otpHash), never the code itself.
  "code_hash" varchar(64) NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "verified_at" timestamptz,
  -- 'first_visit' (typed, not proved: no code the first time a number is used) or 'code'.
  "method" varchar(12) DEFAULT 'code' NOT NULL CHECK ("method" IN ('first_visit', 'code')),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_price_access_phone_created_idx" ON "bulk_price_access" ("phone", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_price_access_verified_idx" ON "bulk_price_access" ("verified_at") WHERE "verified_at" IS NOT NULL;
