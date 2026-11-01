-- ═══════════════════════════════════════════════════════════════════════════
-- 0102 — Commercial cost truth (R3.1 C5/C7, 2026-08-06)
--
-- 1. order_items.cogs_snapshot_ugx — the HISTORICAL cost of the line, frozen
--    at order creation from product_prices.cost_price. Profit must never be
--    derived from the CURRENT cost (§11): a price change after the sale would
--    rewrite history. Nullable: every cost_price is NULL in production today,
--    so snapshots stay NULL until the operator enters costs — and profit
--    reports PARTIAL with the missing component NAMED, never a fabricated
--    margin. Historic lines stay NULL (UNAVAILABLE, not zero).
--
-- 2. media_cost_facts — the ONE canonical media-spend fact source (§12).
--    Server-ingested, immutable source references, duplicate-protected by the
--    logical key. Ships EMPTY: ROAS stays UNAVAILABLE
--    REASON=MEDIA_COST_NOT_CONNECTED until real spend rows exist, and then
--    activates from data alone.
--
-- ADDITIVE AND REVERSIBLE; no INSERTs.
--
-- Rollback:
--   DROP TABLE IF EXISTS media_cost_facts;
--   ALTER TABLE order_items DROP COLUMN IF EXISTS cogs_snapshot_ugx;
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cogs_snapshot_ugx" bigint;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_cost_facts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "spend_date" date NOT NULL,
  "channel" varchar(40) NOT NULL,
  "platform" varchar(80) NOT NULL,
  "account" varchar(120) NOT NULL,
  "campaign" varchar(150) NOT NULL,
  "ad_set_or_group" varchar(150),
  "ad_or_creative" varchar(150),
  "currency" varchar(3) NOT NULL DEFAULT 'UGX',
  "spend_minor" bigint NOT NULL,
  "tax_or_fee_minor" bigint NOT NULL DEFAULT 0,
  "source" varchar(120) NOT NULL,
  "source_reference" varchar(200),
  "ingested_by" uuid,
  "ingested_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "media_cost_facts_spend_nonneg" CHECK ("spend_minor" >= 0 AND "tax_or_fee_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_cost_facts_logical_uq" ON "media_cost_facts"
  ("spend_date", "channel", "platform", "account", "campaign", coalesce("ad_set_or_group", ''), coalesce("ad_or_creative", ''), "source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_cost_facts_date_idx" ON "media_cost_facts" ("spend_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_cost_facts_campaign_idx" ON "media_cost_facts" ("campaign");
