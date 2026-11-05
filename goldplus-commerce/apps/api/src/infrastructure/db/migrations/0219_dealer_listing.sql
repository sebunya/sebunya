-- Dealer locator (Sharp P1, owner 2026-11-05: no dealers are listed yet; the page is ready for when they are).
-- A dealer appears on /dealers only when staff tick "list publicly" on an application; nothing is public by default.
ALTER TABLE "dealer_applications" ADD COLUMN IF NOT EXISTS "listed_publicly" boolean NOT NULL DEFAULT false;
ALTER TABLE "dealer_applications" ADD COLUMN IF NOT EXISTS "public_town" varchar(120);
ALTER TABLE "dealer_applications" ADD COLUMN IF NOT EXISTS "public_address" text;
ALTER TABLE "dealer_applications" ADD COLUMN IF NOT EXISTS "public_phone" varchar(50);
ALTER TABLE "dealer_applications" ADD COLUMN IF NOT EXISTS "country" varchar(2) NOT NULL DEFAULT 'UG';
ALTER TABLE "dealer_applications" ADD COLUMN IF NOT EXISTS "listed_at" timestamptz;
CREATE INDEX IF NOT EXISTS "dealer_applications_listed_idx" ON "dealer_applications" ("country", "public_town") WHERE "listed_publicly" = true;
