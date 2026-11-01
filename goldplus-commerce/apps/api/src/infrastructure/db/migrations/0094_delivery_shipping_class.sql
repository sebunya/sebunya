-- ═══════════════════════════════════════════════════════════════════════════
-- 0094 — Shipping class on products and categories
--
-- Pre-decided 2026-08-06: NOT a weight system. A shipping class is a property
-- of the goods, resolved product override → category default → unresolvable.
-- Unresolvable is PARCEL_CLASS_UNKNOWN and goes to the manual queue; it is
-- NEVER defaulted to small, because small is the cheapest class and a guess
-- would systematically under-charge until a carrier refused the parcel.
--
-- ADDITIVE AND REVERSIBLE. Both columns are nullable with NO default, which is
-- the "all unset at ship" requirement expressed in the schema rather than in a
-- convention: there is no value present to mistake for a decision.
--
-- ZERO INSERTS, like 0092 and 0093.
--
-- Rollback:
--   ALTER TABLE products DROP COLUMN shipping_class;
--   ALTER TABLE categories DROP COLUMN default_shipping_class;
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "shipping_class" varchar(8);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "products" ADD CONSTRAINT "products_shipping_class_check"
    CHECK ("shipping_class" is null or "shipping_class" in ('small','medium','large'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

ALTER TABLE "categories"
  ADD COLUMN IF NOT EXISTS "default_shipping_class" varchar(8);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "categories" ADD CONSTRAINT "categories_default_shipping_class_check"
    CHECK ("default_shipping_class" is null or "default_shipping_class" in ('small','medium','large'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- The parcel plan is recorded on the capture, so a disputed number of fees can
-- be reproduced. Per PARCEL, because that is how a bus office charges.
ALTER TABLE "delivery_quote_capture"
  ADD COLUMN IF NOT EXISTS "parcel_count" integer,
  ADD COLUMN IF NOT EXISTS "per_parcel_fee_ugx" bigint;
