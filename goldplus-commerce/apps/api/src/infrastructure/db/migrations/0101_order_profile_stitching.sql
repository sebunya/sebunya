-- ═══════════════════════════════════════════════════════════════════════════
-- 0101 — Order ↔ experience-profile stitching (R3.1 C2, 2026-08-06)
--
-- Orders have carried anonymous_id / cart_id / attribution_id columns since
-- Pass 13A — and NOTHING ever wrote them (0 of 20 production orders stamped).
-- Commercial attribution needs ONE server-issued identity join between the
-- event stream and orders; that identity is the experience profile (R2).
-- profile_id is stamped at checkout from the HttpOnly visit token, server-side
-- only — the browser cannot supply it.
--
-- ADDITIVE AND REVERSIBLE; nullable; no INSERTs; historic orders stay NULL and
-- are classified UNATTRIBUTABLE, never inferred.
--
-- Rollback:
--   ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_profile_fk;
--   DROP INDEX IF EXISTS orders_profile_idx;
--   ALTER TABLE orders DROP COLUMN IF EXISTS profile_id;
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "profile_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_profile_idx" ON "orders" ("profile_id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_profile_fk') THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_profile_fk"
      FOREIGN KEY ("profile_id") REFERENCES "experience_profiles"("id") ON DELETE SET NULL;
  END IF;
END $$;
