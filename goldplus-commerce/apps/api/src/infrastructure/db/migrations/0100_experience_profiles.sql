-- ═══════════════════════════════════════════════════════════════════════════
-- 0100 — Server-side experience profiles (R2, 2026-08-06)
--
-- The storefront had NO server-side visitor identity: continuity lived in a
-- client-generated localStorage value the server merely echoed, personalisa-
-- tion was structurally impossible from SSR, and the identity_links table —
-- built for exactly this join — had no writer.
--
-- experience_profiles: one row per opaque browser locator. The browser holds
-- ONLY a random HttpOnly cookie value; the server stores its SHA-256. No PII,
-- no cart contents, no behavioural payload — those stay in their canonical
-- tables, joined by profile_id.
--
-- identity_links.profile_id: the join column that finally gives that table a
-- writer. Two partial unique indexes make both link writes idempotent upserts:
--   PROFILE_OBSERVED  profile ↔ legacy client anonymous_id (event stitching)
--   CUSTOMER_LOGIN    profile ↔ authenticated customer (login merge)
--
-- ADDITIVE AND REVERSIBLE; no INSERTs, no row mutations.
--
-- Rollback:
--   DROP INDEX IF EXISTS identity_links_profile_customer_uq;
--   DROP INDEX IF EXISTS identity_links_profile_anon_uq;
--   DROP INDEX IF EXISTS identity_links_profile_idx;
--   ALTER TABLE identity_links DROP COLUMN IF EXISTS profile_id;
--   DROP TABLE IF EXISTS experience_profiles;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "experience_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "token_hash" varchar(64) NOT NULL,
  "customer_id" uuid,
  "customer_linked_at" timestamptz,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "experience_profiles_token_hash_uq" UNIQUE ("token_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experience_profiles_customer_idx" ON "experience_profiles" ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experience_profiles_last_seen_idx" ON "experience_profiles" ("last_seen_at");
--> statement-breakpoint
ALTER TABLE "identity_links" ADD COLUMN IF NOT EXISTS "profile_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identity_links_profile_idx" ON "identity_links" ("profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "identity_links_profile_anon_uq" ON "identity_links" ("profile_id", "anonymous_id") WHERE "link_type" = 'PROFILE_OBSERVED';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "identity_links_profile_customer_uq" ON "identity_links" ("profile_id", "customer_id") WHERE "link_type" = 'CUSTOMER_LOGIN';
