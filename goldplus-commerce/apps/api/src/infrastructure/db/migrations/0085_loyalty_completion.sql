-- 0085: Loyalty completion foundation (loyalty brief PARTs E–H, stage 2).
-- Additive and reversible. The ledger stays append-only truth; nothing here
-- mutates existing rows (there are zero in production — audited 2026-08-04).
-- Every programme-config value starts NULL: null blocks the thing it governs.
-- Rollback: DROP TABLE loyalty_rules, loyalty_redemptions,
--   loyalty_expiry_notices, loyalty_liability_snapshots, loyalty_fraud_signals;
--   ALTER TABLE loyalty_config DROP the 0085 columns; ALTER TABLE
--   loyalty_ledger_entries DROP rule_code, rule_version; restore the two
--   ON DELETE CASCADE FKs; ALTER TABLE users DROP phone_verified_at;
--   ALTER TABLE loyalty_accounts DROP is_dealer. (Comments only.)

-- 1. A financial ledger must not vanish because a parent row was deleted.
--    The 0050 immutability trigger forbids UPDATE/DELETE on entries, but the
--    users→accounts→entries CASCADE chain bypassed it wholesale. RESTRICT
--    makes account closure an explicit, audited application decision (PART I).
ALTER TABLE "loyalty_accounts" DROP CONSTRAINT IF EXISTS "loyalty_accounts_user_id_users_id_fk";
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
ALTER TABLE "loyalty_ledger_entries" DROP CONSTRAINT IF EXISTS "loyalty_ledger_entries_account_id_loyalty_accounts_id_fk";
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_account_id_loyalty_accounts_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "loyalty_accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- 2. Rule versioning (PART E loyalty_rule): entries cite the version that
--    granted them so a rate change never rewrites history.
CREATE TABLE IF NOT EXISTS "loyalty_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "rule_code" varchar(40) NOT NULL,
  "version" integer NOT NULL,
  "earn_basis" varchar(20) NOT NULL,
  "rate" integer NOT NULL,
  "cap_per_period" integer,
  "cap_period" varchar(10),
  "cap_per_customer" integer,
  "eligibility" jsonb,
  "effective_from" timestamp with time zone DEFAULT now() NOT NULL,
  "effective_to" timestamp with time zone,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "active" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_rules_code_version_idx" ON "loyalty_rules" ("rule_code","version");
--> statement-breakpoint
-- Version 1 = the live behaviour verified in the audit: 10 pts / 1,000 UGX on
-- orders.total_amount (delivery-fee-inclusive). Recording reality, not
-- choosing policy — the basis question is PART V decision #6.
INSERT INTO "loyalty_rules" ("rule_code","version","earn_basis","rate","active","approved_at")
VALUES ('order_earn', 1, 'order_total', 10, true, now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint

ALTER TABLE "loyalty_ledger_entries" ADD COLUMN IF NOT EXISTS "rule_code" varchar(40);
--> statement-breakpoint
ALTER TABLE "loyalty_ledger_entries" ADD COLUMN IF NOT EXISTS "rule_version" integer;
--> statement-breakpoint

-- 3. Programme config (PART E loyalty_programme_config) — additive on the
--    existing loyalty_config. EVERY value NULL; null blocks what it governs.
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "point_value_ugx" integer;
--> statement-breakpoint
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "redemption_min_points" integer;
--> statement-breakpoint
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "redemption_max_share_bps" integer;
--> statement-breakpoint
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "budget_cap_points" bigint;
--> statement-breakpoint
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "kill_switch" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "guest_backfill_lookback_days" integer;
--> statement-breakpoint
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "guest_backfill_cap_points" integer;
--> statement-breakpoint
ALTER TABLE "loyalty_config" ADD COLUMN IF NOT EXISTS "singleton" varchar(10) DEFAULT 'config' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_config_singleton_idx" ON "loyalty_config" ("singleton");
--> statement-breakpoint

-- 4. Redemption reservations (PART G): reserve on application, consume on
--    confirmation (delivery for COD), release on abandonment, reverse on refund.
CREATE TABLE IF NOT EXISTS "loyalty_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL,
  "order_id" uuid,
  "points_reserved" integer NOT NULL,
  "value_ugx" bigint NOT NULL,
  "point_value_ugx" integer NOT NULL,
  "rule_version" integer,
  "status" varchar(12) DEFAULT 'reserved' NOT NULL,
  "idempotency_key" varchar(120) NOT NULL,
  "ledger_entry_id" uuid,
  "reserved_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_account_fk"
    FOREIGN KEY ("account_id") REFERENCES "loyalty_accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_redemptions_idem_idx" ON "loyalty_redemptions" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_redemptions_order_idx" ON "loyalty_redemptions" ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_redemptions_status_idx" ON "loyalty_redemptions" ("status");
--> statement-breakpoint

-- 5. Expiry notices (PART H): one row per notice, nobody warned twice.
CREATE TABLE IF NOT EXISTS "loyalty_expiry_notices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL,
  "earn_entry_id" uuid NOT NULL,
  "notice_kind" varchar(10) NOT NULL,
  "channel" varchar(20) NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_expiry_notices_once_idx" ON "loyalty_expiry_notices" ("earn_entry_id","notice_kind");
--> statement-breakpoint

-- 6. Daily liability snapshots (PART O).
CREATE TABLE IF NOT EXISTS "loyalty_liability_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snapshot_date" date NOT NULL,
  "points_outstanding" bigint NOT NULL,
  "points_issued" bigint NOT NULL,
  "points_redeemed" bigint NOT NULL,
  "points_expired" bigint NOT NULL,
  "points_clawed_back" bigint NOT NULL,
  "pending_points" bigint DEFAULT 0 NOT NULL,
  "point_value_ugx" integer,
  "liability_ugx" bigint,
  "breakage_estimate_bps" integer,
  "redemption_rate_bps" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_liability_snapshot_date_idx" ON "loyalty_liability_snapshots" ("snapshot_date");
--> statement-breakpoint

-- 7. Fraud signals (PART N) — feed the existing Fraud Triage, not a new system.
CREATE TABLE IF NOT EXISTS "loyalty_fraud_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid,
  "user_id" uuid,
  "signal_type" varchar(40) NOT NULL,
  "severity" varchar(10) DEFAULT 'medium' NOT NULL,
  "details" jsonb,
  "forwarded_to_fraud_case" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_fraud_signals_account_idx" ON "loyalty_fraud_signals" ("account_id");
--> statement-breakpoint

-- 8. Identity spine (PART I): verified phone on the account; dealer flag on
--    the loyalty account so wholesale volume never distorts consumer reporting.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD COLUMN IF NOT EXISTS "is_dealer" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- 9. Verification attribution (PART J): a scan may carry the signed-in
--    account so verification-linked earning becomes possible. Nullable —
--    anonymous scans stay anonymous.
ALTER TABLE "verification_attempts" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_attempts_user_idx" ON "verification_attempts" ("user_id");
--> statement-breakpoint

-- 10. Redemption on orders (PART G): the applied discount is a recorded fact
--     on the order; the reservation row carries the lifecycle.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "loyalty_discount_ugx" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "loyalty_redemption_id" uuid;
