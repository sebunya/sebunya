-- 0088: Chance-based reward draw (scratch / spin), built on Rob's 2026-08-05
-- instruction to implement the mechanic.
--
-- STRUCTURED TO STAY OUT OF LOTTERY TERRITORY. A prize draw generally needs
-- prize + chance + CONSIDERATION. This design removes consideration and the
-- losing outcome:
--   * a play token is GRANTED for an order that has already been delivered —
--     nobody ever pays, or buys anything extra, in order to play;
--   * every prize tier awards points (points_awarded > 0 is a CHECK) — there
--     is no "you lost" segment, only how much you won;
--   * prizes are loyalty points, which are discount-only, non-transferable and
--     never cash (already stated in the live rewards terms);
--   * odds are computed from stored weights and published to the customer.
-- The mechanic still sits behind loyalty_config.chance_enabled AND the
-- programme kill switch, so it can be stopped without a deploy.
--
-- Additive and reversible.
-- Rollback: DROP TABLE loyalty_draw_results, loyalty_draw_tokens,
--   loyalty_draw_prizes, loyalty_draw_campaigns. (Comment only.)

CREATE TABLE IF NOT EXISTS "loyalty_draw_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(40) NOT NULL,
  "name" varchar(120) NOT NULL,
  "description" varchar(500),
  -- What earns a play token. Closed vocabulary; every value is an event the
  -- system already records as a verified fact.
  "trigger_event" varchar(30) NOT NULL,
  "token_expiry_days" integer NOT NULL,
  -- Hard ceiling on points this campaign may ever award. Token granting stops
  -- when outstanding tokens at the MAXIMUM prize would exceed it, so an
  -- already-granted token is always honourable.
  "budget_cap_points" bigint NOT NULL,
  "points_awarded" bigint DEFAULT 0 NOT NULL,
  "tokens_granted" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT false NOT NULL,
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "loyalty_draw_campaigns_trigger_check"
    CHECK ("trigger_event" in ('order_delivered', 'verification_scan')),
  CONSTRAINT "loyalty_draw_campaigns_budget_check" CHECK ("budget_cap_points" > 0),
  CONSTRAINT "loyalty_draw_campaigns_expiry_check" CHECK ("token_expiry_days" between 1 and 365)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_draw_campaigns_code_uq" ON "loyalty_draw_campaigns" ("code");
--> statement-breakpoint

-- Prize tiers. points_awarded > 0 enforces "no losing segment" at the database.
CREATE TABLE IF NOT EXISTS "loyalty_draw_prizes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "loyalty_draw_campaigns"("id") ON DELETE restrict,
  "label" varchar(80) NOT NULL,
  "points_awarded" integer NOT NULL,
  "weight" integer NOT NULL,
  -- Optional scarcity for a headline tier. NULL = unlimited.
  "max_awards" integer,
  "awards_made" integer DEFAULT 0 NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "loyalty_draw_prizes_points_check" CHECK ("points_awarded" > 0),
  CONSTRAINT "loyalty_draw_prizes_weight_check" CHECK ("weight" > 0),
  CONSTRAINT "loyalty_draw_prizes_max_awards_check" CHECK ("max_awards" is null or "max_awards" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_draw_prizes_campaign_idx" ON "loyalty_draw_prizes" ("campaign_id");
--> statement-breakpoint

-- A play token: one per qualifying event, ever. The unique index on
-- (campaign, source) is what makes granting idempotent under retries.
CREATE TABLE IF NOT EXISTS "loyalty_draw_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "loyalty_draw_campaigns"("id") ON DELETE restrict,
  "user_id" uuid NOT NULL,
  "account_id" uuid,
  "source_type" varchar(30) NOT NULL,
  "source_id" uuid NOT NULL,
  "status" varchar(12) DEFAULT 'available' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "played_at" timestamp with time zone,
  CONSTRAINT "loyalty_draw_tokens_status_check" CHECK ("status" in ('available', 'played', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_draw_tokens_source_uq"
  ON "loyalty_draw_tokens" ("campaign_id", "source_type", "source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_draw_tokens_user_idx" ON "loyalty_draw_tokens" ("user_id", "status");
--> statement-breakpoint

-- The outcome. UNIQUE on token_id is the structural guarantee that one token
-- can never produce two prizes, whatever happens at the application layer.
-- prize_snapshot records the exact odds table in force at play time, so a
-- later weight edit can never rewrite what a customer was actually offered.
CREATE TABLE IF NOT EXISTS "loyalty_draw_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_id" uuid NOT NULL REFERENCES "loyalty_draw_tokens"("id") ON DELETE restrict,
  "campaign_id" uuid NOT NULL REFERENCES "loyalty_draw_campaigns"("id") ON DELETE restrict,
  "prize_id" uuid NOT NULL REFERENCES "loyalty_draw_prizes"("id") ON DELETE restrict,
  "user_id" uuid NOT NULL,
  "points_awarded" integer NOT NULL,
  "ledger_entry_id" uuid,
  "prize_snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "loyalty_draw_results_points_check" CHECK ("points_awarded" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_draw_results_token_uq" ON "loyalty_draw_results" ("token_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_draw_results_user_idx" ON "loyalty_draw_results" ("user_id");
--> statement-breakpoint

-- Launch campaign, seeded INACTIVE. It carries real prize tiers so the odds
-- are reviewable before anything runs; activation is an explicit admin action
-- and additionally requires loyalty_config.chance_enabled.
INSERT INTO "loyalty_draw_campaigns"
  ("code", "name", "description", "trigger_event", "token_expiry_days", "budget_cap_points", "active")
VALUES
  ('delivery_scratch_v1', 'Delivery scratch card',
   'Every delivered order earns one scratch card. Every card wins points — only the amount varies.',
   'order_delivered', 30, 200000, false)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

INSERT INTO "loyalty_draw_prizes" ("campaign_id", "label", "points_awarded", "weight", "max_awards", "display_order")
SELECT c."id", v."label", v."points", v."weight", v."max_awards", v."display_order"
FROM "loyalty_draw_campaigns" c
CROSS JOIN (VALUES
    ('25 points',   25,  6000, NULL::integer, 1),
    ('50 points',   50,  2500, NULL::integer, 2),
    ('100 points',  100, 1200, NULL::integer, 3),
    ('250 points',  250, 250,  NULL::integer, 4),
    ('1,000 points', 1000, 50, 200,           5)
  ) AS v("label", "points", "weight", "max_awards", "display_order")
WHERE c."code" = 'delivery_scratch_v1'
  AND NOT EXISTS (SELECT 1 FROM "loyalty_draw_prizes" p WHERE p."campaign_id" = c."id");
