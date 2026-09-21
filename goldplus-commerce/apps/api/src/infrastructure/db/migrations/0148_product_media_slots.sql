-- Focus 4 (0148): one explicit cover and up to four gallery slots per product.
--
-- Today product_images has no uniqueness at all: nothing stops two primaries,
-- nothing orders the gallery beyond an insert-time counter, and "the cover" is
-- derived three different ways in code. This adds the canonical position:
--
--   slot 1 = cover / main   slot 2 = alternate   slot 3 = detail   slot 4 = context
--
-- EXPAND step only. `slot` is NULL on every existing row; readers keep using
-- is_primary/display_order for a product until the backfill gives it slots
-- (scripts/backfill-product-media-slots.ts). is_primary and display_order stay
-- as a one-way projection written by the mutation service. Nothing is dropped.
--
-- The partial unique indexes ignore NULL slots, so a legacy row never collides
-- and the mutation service can park rows at NULL inside its transaction
-- instead of writing an illegal slot 0/5.
--
-- Rollback: DROP INDEX product_images_product_slot_uq; DROP INDEX product_images_product_asset_uq;
--           ALTER TABLE product_images DROP COLUMN slot, DROP COLUMN updated_at;
--           ALTER TABLE products DROP COLUMN media_revision;
ALTER TABLE "product_images" ADD COLUMN IF NOT EXISTS "slot" smallint;
--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE "product_images" DROP CONSTRAINT IF EXISTS "product_images_slot_range";
--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_slot_range" CHECK ("slot" IS NULL OR ("slot" BETWEEN 1 AND 4));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_images_product_slot_uq" ON "product_images" ("product_id", "slot") WHERE "slot" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_images_product_asset_uq" ON "product_images" ("product_id", "asset_id") WHERE "asset_id" IS NOT NULL AND "slot" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_images_product_slot_idx" ON "product_images" ("product_id", "slot");
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "media_revision" integer NOT NULL DEFAULT 0;
