-- Miscellaneous storefront copy (support intro + payment-method labels) as ONE
-- admin-editable JSONB document (singleton row, id pinned true). Same shape and
-- safety as nav_config/business_info: additive, idempotent, seeded at boot.
CREATE TABLE IF NOT EXISTS "storefront_copy" (
  "id" boolean PRIMARY KEY DEFAULT true,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "updated_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "storefront_copy_singleton" CHECK ("id" = true)
);
