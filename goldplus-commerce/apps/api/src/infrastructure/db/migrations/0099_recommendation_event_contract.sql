-- ═══════════════════════════════════════════════════════════════════════════
-- 0099 — Recommendation event contract hardening (R1, 2026-08-06)
--
-- The events table had NO database-level idempotency: dedup was a
-- SELECT-then-INSERT race, and a beacon retry could double-write. Four new
-- columns, all nullable — historic rows stay exactly as they are
-- (HISTORIC_UNKNOWN is preserved, never backfilled):
--
-- dedupe_key      deterministic idempotency key computed by the producer for
--                 event types that dedupe (page views, impressions). A partial
--                 UNIQUE index makes "duplicate retry produces one event" a
--                 database guarantee instead of an application hope. Clicks
--                 and add-to-carts deliberately carry NULL — they are never
--                 deduped (pinned by TrackRecommendationEventUseCase tests).
-- schema_version  contract version of the writing producer (new writes: 2).
--                 NULL = written before the contract existed.
-- producer        which producer wrote the row (public-api / web-relay / api-engine).
-- profile_id      the server-issued anonymous experience profile (R2). NULL on
--                 legacy rows and on writes from producers that predate it.
--
-- ADDITIVE AND REVERSIBLE; no INSERTs, no row mutations.
--
-- ORDERING: this migration must land BEFORE the application roll — the new
-- event writer sends these columns unconditionally, so new code on an
-- un-migrated database fails every event insert. The rollback below is only
-- legal after rolling the application back first, for the same reason.
-- Index creation is non-CONCURRENT (milliseconds at today's 346 rows); on a
-- grown table, re-running these statements would block writes — use
-- CONCURRENTLY out-of-band instead.
--
-- Rollback:
--   DROP INDEX IF EXISTS recommendation_events_dedupe_key_uq;
--   DROP INDEX IF EXISTS recommendation_events_profile_idx;
--   DROP INDEX IF EXISTS recommendation_events_profile_created_at_idx;
--   ALTER TABLE recommendation_events DROP COLUMN IF EXISTS dedupe_key;
--   ALTER TABLE recommendation_events DROP COLUMN IF EXISTS schema_version;
--   ALTER TABLE recommendation_events DROP COLUMN IF EXISTS producer;
--   ALTER TABLE recommendation_events DROP COLUMN IF EXISTS profile_id;
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "recommendation_events" ADD COLUMN IF NOT EXISTS "dedupe_key" varchar(160);
--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN IF NOT EXISTS "schema_version" integer;
--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN IF NOT EXISTS "producer" varchar(80);
--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD COLUMN IF NOT EXISTS "profile_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recommendation_events_dedupe_key_uq" ON "recommendation_events" ("dedupe_key") WHERE "dedupe_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_profile_idx" ON "recommendation_events" ("profile_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_profile_created_at_idx" ON "recommendation_events" ("profile_id", "created_at");
