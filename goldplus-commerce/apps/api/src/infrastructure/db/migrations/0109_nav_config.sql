-- 0109 — Header/nav CMS content, DB-backed (§9).
--
-- The nav is heterogeneous (rail, mega panels, battery finder, flash clock, NBA
-- copy, popover/mini-cart copy, global settings) — unlike the homogeneous hero
-- slides. Storing it as ONE validated JSONB document keeps migration risk low and
-- lets the whole header be edited and versioned atomically.
--
-- Singleton pattern (mirrors hero_settings): PK is a boolean pinned true, so a
-- second row is impossible. The shape/validity of `config` is enforced in the
-- application layer (packages/shared nav validation), not by column constraints —
-- a JSONB document cannot be CHECK-constrained field by field.
--
-- ADDITIVE AND REVERSIBLE; no INSERTs. Seeding is done idempotently at boot.
-- Rollback: DROP TABLE IF EXISTS "nav_config";

CREATE TABLE IF NOT EXISTS "nav_config" (
  "id"         boolean PRIMARY KEY DEFAULT true,
  "config"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version"    integer NOT NULL DEFAULT 1,
  "updated_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "nav_config_singleton" CHECK ("id" = true)
);
