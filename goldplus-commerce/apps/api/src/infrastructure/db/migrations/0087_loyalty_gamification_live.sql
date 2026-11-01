-- 0087: Gamification goes LIVE (Rob's 2026-08-05 instruction: implement the
-- deferred gamification modules and apply the recommended programme values).
-- Additive and reversible. Every point still flows through the append-only
-- ledger; every award is idempotent; the kill switch and budget cap remain the
-- programme-wide brakes. Chance-based mechanics are NOT included — the brief's
-- own hard stop (legal read first) still governs them; only the config flag is
-- reserved, default false.
-- Rollback: DROP TABLE loyalty_referrals; ALTER TABLE users DROP COLUMN
--   date_of_birth, DROP COLUMN referral_code; ALTER TABLE loyalty_config DROP
--   the seven 0087 columns; ALTER TABLE fake_product_reports DROP COLUMN
--   reporter_user_id; deactivate rules/tiers via UPDATE. (Comments only.)

-- ── Referrals (brief PART G earn source; PART K fraud: self-referral/rings) ──
CREATE TABLE IF NOT EXISTS "loyalty_referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(12) NOT NULL,
  "referrer_user_id" uuid NOT NULL,
  "referee_user_id" uuid NOT NULL,
  "status" varchar(12) DEFAULT 'pending' NOT NULL,
  "qualifying_order_id" uuid,
  "referrer_entry_id" uuid,
  "referee_entry_id" uuid,
  "rejection_reason" varchar(120),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "loyalty_referrals_status_check" CHECK ("status" in ('pending','awarded','rejected')),
  CONSTRAINT "loyalty_referrals_no_self_check" CHECK ("referrer_user_id" <> "referee_user_id")
);
--> statement-breakpoint
-- One referral per referee, ever — a customer can only be referred once.
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_referrals_referee_uq" ON "loyalty_referrals" ("referee_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_referrals_referrer_idx" ON "loyalty_referrals" ("referrer_user_id");
--> statement-breakpoint

-- ── Identity columns: shareable referral code + birthday (earn source) ──────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" varchar(12);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_referral_code_uq" ON "users" ("referral_code") WHERE "referral_code" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "date_of_birth" date;
--> statement-breakpoint

-- ── Counterfeit-report attribution (a signed-in reporter can earn) ──────────
ALTER TABLE "fake_product_reports" ADD COLUMN IF NOT EXISTS "reporter_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "fake_product_reports" ADD COLUMN IF NOT EXISTS "loyalty_entry_id" uuid;
--> statement-breakpoint

-- ── Programme config: gamification values (config, not code — PART V rule) ──
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "referral_referrer_points" integer;
--> statement-breakpoint
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "referral_referee_points" integer;
--> statement-breakpoint
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "birthday_points" integer;
--> statement-breakpoint
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "streak_target_orders" integer;
--> statement-breakpoint
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "streak_window_days" integer;
--> statement-breakpoint
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "streak_reward_points" integer;
--> statement-breakpoint
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "chance_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "terms_version" varchar(20);
--> statement-breakpoint

-- ── Apply the approved programme values (Rob, 2026-08-05: "don't leave any
-- thing undone or debated" — the PART V recommendations become the live
-- config; every one remains changeable in admin without a deploy) ────────────
UPDATE "loyalty_config" SET
  "point_value_ugx" = 20,
  "redemption_min_points" = 500,
  "redemption_max_share_bps" = 5000,
  "budget_cap_points" = 1000000,
  "guest_backfill_lookback_days" = 90,
  "guest_backfill_cap_points" = 5000,
  "referral_referrer_points" = 200,
  "referral_referee_points" = 100,
  "birthday_points" = 150,
  "streak_target_orders" = 3,
  "streak_window_days" = 90,
  "streak_reward_points" = 300,
  "terms_version" = 'v1',
  "updated_at" = now()
WHERE "singleton" = 'config';
--> statement-breakpoint

-- ── Activate the non-order earn rules (versioned; history isolated) ─────────
INSERT INTO "loyalty_rules" ("rule_code","version","earn_basis","rate","cap_per_period","cap_period","cap_per_customer","active","approved_at")
VALUES
  ('verification_scan', 1, 'event', 25, 5, 'day', NULL, true, now()),
  ('counterfeit_report', 1, 'event', 250, 1, 'day', NULL, true, now()),
  ('phone_verification', 1, 'event', 100, NULL, NULL, 1, true, now())
ON CONFLICT ("rule_code","version") DO UPDATE SET "active" = true, "approved_at" = now();
--> statement-breakpoint

-- ── Activate tiers with service-based benefits (no discount double-liability) ─
UPDATE "loyalty_tiers" SET "threshold_lifetime_points" = 0,
  "benefits" = '{"prioritySupport":false,"extendedWarrantyHandling":false,"earlyAccess":false}'::jsonb,
  "active" = true, "updated_at" = now() WHERE "code" = 'T1';
--> statement-breakpoint
UPDATE "loyalty_tiers" SET "threshold_lifetime_points" = 2500,
  "benefits" = '{"prioritySupport":true,"extendedWarrantyHandling":false,"earlyAccess":false}'::jsonb,
  "active" = true, "updated_at" = now() WHERE "code" = 'T2';
--> statement-breakpoint
UPDATE "loyalty_tiers" SET "threshold_lifetime_points" = 10000,
  "benefits" = '{"prioritySupport":true,"extendedWarrantyHandling":true,"earlyAccess":false}'::jsonb,
  "active" = true, "updated_at" = now() WHERE "code" = 'T3';
--> statement-breakpoint
UPDATE "loyalty_tiers" SET "threshold_lifetime_points" = 30000,
  "benefits" = '{"prioritySupport":true,"extendedWarrantyHandling":true,"earlyAccess":true}'::jsonb,
  "active" = true, "updated_at" = now() WHERE "code" = 'T4';
--> statement-breakpoint

-- ── Badge set: small, verification-weighted (brief PART L) ──────────────────
INSERT INTO "gamification_badges" ("key","title","description") VALUES
  ('authenticator', 'Authenticator', 'Verified your first genuine GoldPlus product.'),
  ('counterfeit_hunter', 'Counterfeit Hunter', 'Reported a counterfeit that our team confirmed.'),
  ('verified_buyer', 'Verified Buyer', 'Verified your phone number on your account.'),
  ('first_order', 'First Delivery', 'Received your first delivered GoldPlus order.'),
  ('loyal_customer', 'Loyal Customer', 'Five delivered orders with GoldPlus.'),
  ('referrer', 'Connector', 'Introduced a friend whose first order was delivered.')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- ── Missions: exactly three ACTIVE (brief: "two or three, not ten"),
-- each with a verified completion event ─────────────────────────────────────
INSERT INTO "gamification_missions" ("key","title","description","kind","threshold","reward_points","status") VALUES
  ('five_deliveries', 'Five Deliveries', 'Have five orders delivered to earn a bonus and the Loyal Customer badge.', 'PURCHASE_COUNT', 5, 250, 'ACTIVE'),
  ('verify_ten', 'Serial Authenticator', 'Verify ten genuine products (yours or ones you are checking before buying).', 'VERIFICATION_COUNT', 10, 100, 'ACTIVE'),
  ('order_streak_3', 'On A Roll', 'Three delivered orders in a row, each within 90 days of the last.', 'STREAK_ORDERS', 3, 300, 'ACTIVE')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Link mission-completion badges where one exists.
UPDATE "gamification_badges" SET "mission_id" = (SELECT "id" FROM "gamification_missions" WHERE "key" = 'five_deliveries')
WHERE "key" = 'loyal_customer' AND "mission_id" IS NULL;
