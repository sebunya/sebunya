-- ═══════════════════════════════════════════════════════════════════════════
-- 0108 — Hero telemetry (Task 3, 2026-08-07)
--
-- "Measure it, or it is decoration." Per-slide impressions and clicks, with the
-- position the slide occupied and the visitor segment, so the 12-slide library
-- can be pruned by evidence rather than opinion.
--
-- This is the hero's OWN small event owner, deliberately separate from
-- recommendation_events: the hero is a marketing surface, not a recommendation
-- placement, and the R3 programme keeps ONE recommendation placement vocabulary.
-- Conflating them would corrupt both reports.
--
-- No PII: a slide key, an event type, a position, a segment, an optional
-- server profile id (already server-issued), and a day. The profile id is the
-- same non-identifying continuity key the recommendation events use.
--
-- ADDITIVE AND REVERSIBLE; no INSERTs.
--
-- Rollback: DROP TABLE IF EXISTS hero_events;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "hero_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_type" varchar(12) NOT NULL,
  "slide_key" varchar(24) NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "segment" varchar(16) NOT NULL DEFAULT 'unknown',
  "profile_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hero_events_type_vocab" CHECK ("event_type" IN ('IMPRESSION','CLICK'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hero_events_slide_idx" ON "hero_events" ("slide_key", "event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hero_events_created_idx" ON "hero_events" ("created_at");
