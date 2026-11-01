-- ═══════════════════════════════════════════════════════════════════════════
-- 0104 — Product cost entry (production closure, 2026-08-07)
--
-- WHY THIS EXISTS. `product_prices.cost_price` had NO writer anywhere: not in
-- the admin routes, not in PIM import, not in any use case. The commercial
-- report told the operator to "enter costs to activate" profit, and there was
-- nowhere to enter them. Profit was not waiting on business data; it was
-- waiting on a feature nobody had built.
--
-- ONE cost owner, effective-dated. `product_cost_entries` is the history: what
-- a product cost, from when, who said so, and why. `product_prices.cost_price`
-- stays exactly what it was — the CURRENT effective cost — and is now a
-- materialisation of this table rather than an orphan column. That keeps the
-- COGS snapshot reader in DrizzleOrderRepository working unchanged.
--
-- Effective dating is what makes cost honest over time. A cost entered today
-- with effective_from 2026-01-01 changes what NEW orders snapshot; it can
-- never rewrite an order_items.cogs_snapshot_ugx already frozen at sale. That
-- immutability is the whole point of the snapshot and is not weakened here.
--
-- Corrections are entries, not edits: `corrects_entry_id` points at the row
-- being replaced and `superseded_at` retires it, so the audit trail keeps the
-- wrong number AND the right one. Nothing is ever UPDATEd in place except the
-- supersession stamp.
--
-- Currency is stored explicitly. UGX is the only value the application accepts
-- today; the column exists so a second currency is a data decision later
-- rather than a schema migration under pressure.
--
-- ADDITIVE AND REVERSIBLE; no INSERTs. Ships EMPTY: every cost_price in the
-- catalogue is NULL, so profit stays UNAVAILABLE with its missing components
-- named until an operator enters real numbers.
--
-- Rollback:
--   DROP TABLE IF EXISTS product_cost_entries;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "product_cost_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "cost_price_ugx" bigint NOT NULL,
  "currency" varchar(3) NOT NULL DEFAULT 'UGX',
  "effective_from" date NOT NULL,
  "source" varchar(120) NOT NULL,
  "note" text,
  "entered_by" uuid,
  "corrects_entry_id" uuid REFERENCES "product_cost_entries"("id"),
  "superseded_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  -- A cost of zero is legitimate (a free sample, a bundled item); a negative
  -- one is not, and neither is a number large enough to be a typo.
  CONSTRAINT "product_cost_entries_cost_sane" CHECK ("cost_price_ugx" >= 0 AND "cost_price_ugx" <= 10000000000)
);
--> statement-breakpoint
-- One live cost per product per effective date. A re-import of the same day is
-- a correction, not a second truth.
CREATE UNIQUE INDEX IF NOT EXISTS "product_cost_entries_live_uq"
  ON "product_cost_entries" ("product_id", "effective_from")
  WHERE "superseded_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_cost_entries_product_idx" ON "product_cost_entries" ("product_id", "effective_from" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_cost_entries_created_idx" ON "product_cost_entries" ("created_at");
