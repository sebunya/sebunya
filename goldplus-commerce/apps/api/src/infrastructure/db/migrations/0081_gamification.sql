-- Gamification scaffold (§32 tail) on the dormant loyalty core.
--
-- WHY
-- Missions/badges get real definition tables and a dry evaluator over real
-- commerce data; the customer_badges award ledger is created now but stays EMPTY
-- until loyalty activation — awarding is refused with LOYALTY_DORMANT, matching
-- the loyalty core's own no-value-until-activation rule.
--
-- LOCK RISK: three new tables, additive, safe online.

CREATE TABLE IF NOT EXISTS "gamification_missions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" varchar(60) NOT NULL,
  "title" varchar(200) NOT NULL,
  "description" varchar(500),
  "kind" varchar(30) NOT NULL,
  "threshold" integer NOT NULL,
  "reward_points" integer DEFAULT 0 NOT NULL,
  "status" varchar(12) DEFAULT 'DRAFT' NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gamification_missions_key_uq" ON "gamification_missions" ("key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gamification_badges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" varchar(60) NOT NULL,
  "title" varchar(200) NOT NULL,
  "description" varchar(500),
  "mission_id" uuid REFERENCES "gamification_missions"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gamification_badges_key_uq" ON "gamification_badges" ("key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_badges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "badge_id" uuid NOT NULL REFERENCES "gamification_badges"("id") ON DELETE CASCADE,
  "awarded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_badges_user_badge_uq" ON "customer_badges" ("user_id","badge_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_badges_user_idx" ON "customer_badges" ("user_id");
