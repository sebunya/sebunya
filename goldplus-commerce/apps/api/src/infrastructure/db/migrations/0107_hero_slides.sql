-- ═══════════════════════════════════════════════════════════════════════════
-- 0107 — Hero slider content (2026-08-07)
--
-- The homepage hero becomes editable by marketing without a developer. The 12
-- campaign slides and the three global settings live here instead of in the
-- markup, so a headline, price, link or image can change without a deploy.
--
-- `slide_key` is the LOCKED identifier the client engine keys its eligibility
-- and scoring off (LIB[id]). It is unique and never renamed — renaming one
-- silently drops a campaign from personalisation.
--
-- `headline` may contain <em>…</em> and nothing else; the application escapes
-- everything and restores only that one tag before rendering. The database
-- stores what the operator typed; the SANITISER, not the column, is the XSS
-- boundary.
--
-- `extras` carries the per-campaign data that only some slides have — a flash
-- sale's end and prices, the welcome code, the delivery fee table, the scratch
-- prize table — so the shared columns stay honest and a new campaign shape is
-- a data change, not a migration.
--
-- hero_settings is a single row (id = TRUE) holding the global knobs: how many
-- slides show per visit, the dwell time, and whether autoplay runs.
--
-- ADDITIVE AND REVERSIBLE. No INSERTs here: the 12 slides are seeded
-- idempotently at boot (HeroSlideSeeder), on slide_key conflict do nothing, so
-- a fresh database gets the library and an operator's edits are never
-- overwritten by a redeploy.
--
-- Rollback:
--   DROP TABLE IF EXISTS hero_slides;
--   DROP TABLE IF EXISTS hero_settings;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "hero_slides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slide_key" varchar(24) NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "enabled" boolean NOT NULL DEFAULT true,
  "theme" varchar(12) NOT NULL,
  "tint" varchar(1) NOT NULL DEFAULT 'a',
  "media" varchar(8) NOT NULL DEFAULT 'stage',
  "kicker" varchar(48) NOT NULL DEFAULT '',
  "headline" varchar(200) NOT NULL DEFAULT '',
  "subcopy" varchar(240) NOT NULL DEFAULT '',
  "cta_label" varchar(48) NOT NULL DEFAULT '',
  "cta_url" varchar(512) NOT NULL DEFAULT '',
  "fine_print" varchar(160) NOT NULL DEFAULT '',
  "image_url" varchar(512) NOT NULL DEFAULT '',
  "image_alt" varchar(200) NOT NULL DEFAULT '',
  "priority" integer NOT NULL DEFAULT 0,
  "extras" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hero_slides_theme_vocab" CHECK ("theme" IN ('offer','logistics','loyalty','product','brand','trust')),
  CONSTRAINT "hero_slides_tint_vocab" CHECK ("tint" IN ('a','b','c','d')),
  CONSTRAINT "hero_slides_media_vocab" CHECK ("media" IN ('stage','bleed','card')),
  CONSTRAINT "hero_slides_priority_range" CHECK ("priority" >= 0 AND "priority" <= 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hero_slides_key_uq" ON "hero_slides" ("slide_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hero_slides_order_idx" ON "hero_slides" ("enabled", "position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hero_settings" (
  -- Single-row table: the primary key is pinned TRUE so a second row is
  -- impossible, which is the cheapest way to keep "global settings" global.
  "id" boolean PRIMARY KEY DEFAULT true,
  "slides_shown" integer NOT NULL DEFAULT 4,
  "dwell_ms" integer NOT NULL DEFAULT 6000,
  "autoplay" boolean NOT NULL DEFAULT true,
  "updated_by" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hero_settings_singleton" CHECK ("id" = true),
  CONSTRAINT "hero_settings_shown_range" CHECK ("slides_shown" >= 1 AND "slides_shown" <= 8),
  CONSTRAINT "hero_settings_dwell_range" CHECK ("dwell_ms" >= 2000 AND "dwell_ms" <= 20000)
);
