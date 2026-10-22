-- 0201: an optional photo on a gift card bought online (owner brief 2026-10-21).
--
-- The buyer may add one photo. It is cropped on their phone, re-encoded here (a square JPEG, at most 1080 px, with
-- every piece of metadata such as GPS location removed), and stored in this table, not on disk, so it is backed up
-- with the purchase it belongs to. It is shown only on that card: to the person it is for (through the card's
-- private link) and to the buyer (through their reference), never on a public page. Deleted: a photo nothing claimed,
-- after three days; the photo of a purchase that ended unpaid or refunded, 30 days after it ended; the photo of a card
-- that is used up, cancelled or expired, 90 days later; anyone's on an erasure. The person it is for, the buyer and
-- staff can each remove it at any time.
--
-- uploader_key is an HMAC (peppered, like every identity hash here) of the visitor's rate-limit key: it lets the
-- shop cap uploads per visitor per day without keeping an address. Not personal data on its own; gone with the row.
--
-- Additive. Rollback: drop the column, then the table.

CREATE TABLE IF NOT EXISTS "gift_card_photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "image" bytea NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "attached_at" timestamp with time zone,
  "uploader_key" varchar(64),
  CONSTRAINT "gift_card_photos_size_chk" CHECK (octet_length("image") <= 1500000 AND "width" BETWEEN 200 AND 1080 AND "height" BETWEEN 200 AND 1080)
);
-- Serves the daily ceilings (all uploads since, and one visitor's) and the unclaimed sweep.
CREATE INDEX IF NOT EXISTS "gift_card_photos_created_idx" ON "gift_card_photos" ("created_at");
CREATE INDEX IF NOT EXISTS "gift_card_photos_uploader_idx" ON "gift_card_photos" ("uploader_key", "created_at") WHERE "uploader_key" IS NOT NULL;

ALTER TABLE "gift_card_purchases" ADD COLUMN IF NOT EXISTS "photo_id" uuid REFERENCES "gift_card_photos"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "gift_card_purchases_photo_uq" ON "gift_card_purchases" ("photo_id") WHERE "photo_id" IS NOT NULL;
