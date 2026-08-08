-- Marketing attribution for orders (last-touch UTM + referrer).
--
-- Deliberately a SIDE table keyed by the order, written best-effort AFTER an order
-- is created — the money path (order creation, pricing, payment) is never touched
-- by attribution. Additive and idempotent; a rollback is a plain DROP.
CREATE TABLE IF NOT EXISTS "order_attribution" (
  "order_id" uuid PRIMARY KEY,
  "order_number" varchar(20),
  "source" varchar(120),
  "medium" varchar(120),
  "campaign" varchar(160),
  "term" varchar(160),
  "content" varchar(160),
  "landing_path" text,
  "referrer" text,
  "first_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_attribution_number_idx" ON "order_attribution" ("order_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_attribution_channel_idx" ON "order_attribution" ("source", "medium", "campaign");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_attribution_created_idx" ON "order_attribution" ("created_at");
