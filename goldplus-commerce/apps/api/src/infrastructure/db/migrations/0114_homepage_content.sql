-- Homepage marketing content (trust strip + business-pathway cards) as ONE
-- admin-editable JSONB document (singleton row, id pinned true). Same shape and
-- safety as nav_config/business_info: additive, idempotent, seeded at boot.
CREATE TABLE IF NOT EXISTS "homepage_content" (
  "id" boolean PRIMARY KEY DEFAULT true,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "updated_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "homepage_content_singleton" CHECK ("id" = true)
);
