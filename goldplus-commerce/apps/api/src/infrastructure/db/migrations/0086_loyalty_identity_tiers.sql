-- 0086: Loyalty identity, merge, tiers, phone OTP (loyalty brief PARTs I/J/L).
-- Additive and reversible. Account merge honours the append-only ledger: rows
-- are NEVER moved (the 0050 trigger forbids it) — a merge is a recorded fact
-- and balance reads aggregate across merged accounts with original dates.
-- Rollback: DROP TABLE loyalty_account_merges, loyalty_tiers,
--   loyalty_tier_assignments, phone_verification_codes. (Comments only.)

CREATE TABLE IF NOT EXISTS "loyalty_account_merges" (
  "merged_account_id" uuid PRIMARY KEY NOT NULL,
  "survivor_account_id" uuid NOT NULL,
  "actor_id" uuid,
  "note" varchar(300),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Tiers (PART L): engine present, EVERY threshold/benefit NULL and inactive
-- until Rob sets them (PART V #8). Nothing assigns until a tier is active.
CREATE TABLE IF NOT EXISTS "loyalty_tiers" (
  "code" varchar(20) PRIMARY KEY NOT NULL,
  "name" varchar(60) NOT NULL,
  "threshold_lifetime_points" integer,
  "benefits" jsonb,
  "rank" integer NOT NULL,
  "active" boolean DEFAULT false NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "loyalty_tiers" ("code","name","rank") VALUES
  ('T1','Member',1), ('T2','Silver',2), ('T3','Gold',3), ('T4','Platinum',4)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "loyalty_tier_assignments" (
  "account_id" uuid PRIMARY KEY NOT NULL,
  "tier_code" varchar(20) NOT NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notified_at" timestamp with time zone
);
--> statement-breakpoint

-- Phone verification (PART I identity spine): short-lived hashed OTPs.
CREATE TABLE IF NOT EXISTS "phone_verification_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "phone_e164" varchar(20) NOT NULL,
  "code_hash" varchar(64) NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phone_verification_user_idx" ON "phone_verification_codes" ("user_id");
