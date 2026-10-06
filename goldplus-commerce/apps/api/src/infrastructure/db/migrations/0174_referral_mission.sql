-- 0174: the third mission rewards introducing friends and family, not scanning;
-- lifetime points start counting reductions from this deploy; terms v2.
-- Additive and reversible: one archived row, one new row, one new nullable
-- column, one version string. No ledger row is written or changed; points
-- move only through the append-only ledger, as awards happen.
-- Rollback (comments only; roll the code back first):
--   UPDATE gamification_missions SET status = 'ACTIVE' WHERE key = 'verify_ten';
--   UPDATE gamification_missions SET status = 'ARCHIVED' WHERE key = 'refer_three';
--     (archived, never deleted: paid awards carry its key in the ledger)
--   UPDATE loyalty_config SET terms_version = 'v1' WHERE terms_version = 'v2';
--   ALTER TABLE loyalty_config DROP COLUMN lifetime_reductions_from;
--
-- 'verify_ten' (Serial Authenticator, 100 pts) paid a bonus for ten successful
-- product checks. Each scan already earns its own points (verification_scan,
-- capped per day) and the first one earns the Authenticator badge, so the
-- mission rewarded volume of scanning rather than anything new for the shop.
-- It is ARCHIVED, not deleted: customers' history and any completion stay
-- intact, and an operator can reactivate it in /admin/loyalty/gamification.
--
-- 'refer_three' counts AWARDED referrals (loyalty_referrals.status), so it only
-- moves when a friend's first order is delivered, after the self-referral,
-- shared-phone and monthly-cap checks. The bonus sits on top of the per-friend
-- referral points.
UPDATE "gamification_missions" SET "status" = 'ARCHIVED'
WHERE "key" = 'verify_ten' AND "status" = 'ACTIVE';
--> statement-breakpoint
INSERT INTO "gamification_missions" ("key","title","description","kind","threshold","reward_points","status") VALUES
  ('refer_three', 'Friends & Family', 'Introduce three friends or family members. When the third one''s first order is delivered, you earn this bonus on top of your referral points.', 'REFERRAL_COUNT', 3, 300, 'ACTIVE')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- The published terms change with this release (levels count every point;
-- the Friends & Family bonus; reversed points stop counting from 7 Oct 2026),
-- so their version moves on. Only from the version this build replaces: an
-- operator's own version string is left alone.
UPDATE "loyalty_config" SET "terms_version" = 'v2', "updated_at" = now()
WHERE "singleton" = 'config' AND "terms_version" = 'v1';
--> statement-breakpoint
-- Lifetime points now count reductions (refund reversals, negative
-- corrections), but not retroactively (loyalty terms §9): only those dated
-- from the moment this release goes live. Recorded here, at deploy time,
-- rather than guessed in code. NULL (a config row created later, with no
-- history before it) means every reduction counts.
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "lifetime_reductions_from" timestamp with time zone;
--> statement-breakpoint
UPDATE "loyalty_config" SET "lifetime_reductions_from" = now()
WHERE "singleton" = 'config' AND "lifetime_reductions_from" IS NULL;
