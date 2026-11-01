-- Product discovery taxonomy as ONE admin-editable JSONB document (singleton
-- row, id pinned true) — categories, subcategories, inference keywords, homepage
-- tiles and aliases. Same shape and safety as nav_config/business_info: additive,
-- idempotent, seeded at boot. The document is a JSON ARRAY of categories.
CREATE TABLE IF NOT EXISTS "taxonomy_config" (
  "id" boolean PRIMARY KEY DEFAULT true,
  "config" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "updated_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "taxonomy_config_singleton" CHECK ("id" = true)
);
