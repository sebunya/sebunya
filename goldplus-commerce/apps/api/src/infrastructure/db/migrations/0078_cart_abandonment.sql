-- Wave 2E-1 — server-side cart abandonment classification.
--
-- WHY
-- The abandoned-cart-events queue existed with no producer and no worker, and no
-- table recorded what "abandoned" means. This table is the single definition: the
-- hourly evaluator classifies carts with items whose last activity crossed the
-- threshold, the queue carries each new classification to downstream consumers,
-- and future campaign eligibility reads THESE rows (behind consent/suppression
-- gates added with the campaign wave).
--
-- LOCK RISK: one new table, additive, safe online.

CREATE TABLE IF NOT EXISTS "cart_abandonments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cart_id" uuid NOT NULL,
  "owner_kind" varchar(8),
  "owner_id" varchar(128),
  "item_count" integer NOT NULL,
  "subtotal_ugx" bigint NOT NULL,
  "reason" varchar(30) DEFAULT 'STALE_TIMEOUT' NOT NULL,
  "status" varchar(12) DEFAULT 'OPEN' NOT NULL,
  "classified_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "last_activity_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cart_abandonments_open_cart_uq" ON "cart_abandonments" ("cart_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cart_abandonments_status_idx" ON "cart_abandonments" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cart_abandonments_classified_idx" ON "cart_abandonments" ("classified_at");
