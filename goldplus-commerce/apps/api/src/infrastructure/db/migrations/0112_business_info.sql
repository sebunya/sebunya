-- Business / contact info as ONE admin-editable JSONB document (singleton row,
-- id pinned true) — address, hours, phone, WhatsApp, delivery window, socials.
-- Same shape and safety as nav_config: additive, idempotent, seeded at boot.
CREATE TABLE IF NOT EXISTS "business_info" (
  "id" boolean PRIMARY KEY DEFAULT true,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "updated_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "business_info_singleton" CHECK ("id" = true)
);
