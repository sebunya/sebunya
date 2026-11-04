-- Baymard wave 3 (2026-11-04). Two facts the product page could not say before:
-- P9: the shop's own reply under a published review, styled apart from the buyer's words.
-- P1: products that are one item in several capacities or colours share a variant group,
--     so each page offers the others instead of leaving the shopper to search again.
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "staff_reply" text;
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "staff_replied_at" timestamptz;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "variant_group" varchar(60);
CREATE INDEX IF NOT EXISTS "products_variant_group_idx" ON "products" ("variant_group") WHERE "variant_group" IS NOT NULL;
