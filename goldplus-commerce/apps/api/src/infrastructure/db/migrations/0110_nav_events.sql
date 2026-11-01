-- 0110 — Nav telemetry (§10). Its OWN owner, deliberately separate from
-- hero_events and recommendation_events: the nav is neither a marketing hero
-- surface nor an R3 recommendation placement, and conflating the vocabularies
-- corrupts all three reports. No PII (search terms are product queries, the same
-- class the recommendation logs already retain).
--
-- Metrics captured: NBA impressions/clicks/dismissals (by segment), search
-- suggestion click-through, zero-result terms, battery-finder submits, WhatsApp
-- fallback taps, mini-cart open->checkout, panel opens by category.
--
-- ADDITIVE AND REVERSIBLE; no INSERTs.
-- Rollback: DROP TABLE IF EXISTS "nav_events";

CREATE TABLE IF NOT EXISTS "nav_events" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_type" varchar(24) NOT NULL,
  "item_key"   varchar(32) NOT NULL DEFAULT '',
  "position"   integer     NOT NULL DEFAULT 0,
  "segment"    varchar(16) NOT NULL DEFAULT 'unknown',
  "term"       varchar(80),
  "profile_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "nav_events_type_vocab" CHECK ("event_type" IN (
    'NBA_IMPRESSION','NBA_CLICK','NBA_DISMISS',
    'SEARCH_SUGGEST_SHOWN','SEARCH_SUGGEST_CLICK','SEARCH_ZERO',
    'BATTERY_FINDER_SUBMIT','WHATSAPP_TAP',
    'MINICART_OPEN','MINICART_CHECKOUT','PANEL_OPEN')),
  CONSTRAINT "nav_events_segment_vocab" CHECK ("segment" IN (
    'new','returning','signed_in','unknown'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nav_events_type_item_idx" ON "nav_events" ("event_type","item_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nav_events_created_idx"   ON "nav_events" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nav_events_zero_term_idx" ON "nav_events" ("term")
  WHERE "event_type" = 'SEARCH_ZERO' AND "term" IS NOT NULL;
