-- ═══════════════════════════════════════════════════════════════════════════
-- 0103 — The refund ledger (production closure, 2026-08-07)
--
-- WHY THIS EXISTS. The refund path already in production accepts a PARTIAL
-- amount (RefundPesaPalPaymentUseCase: "partials are permitted because a
-- delivery-fee variance may owe less than the whole order"), but nothing
-- recorded a refund anywhere. Three consequences, all real:
--
--   1. OVER-REFUND. The only guard was `amount <= attempt.amount`, checked
--      against the ORIGINAL collected amount. Two 60% refunds each passed that
--      test, so 120% of the money could be returned. There was no ledger to
--      subtract what had already been given back.
--   2. NO IDEMPOTENCY. A retried request issued a second provider refund.
--   3. WHOLE-ORDER EROSION. Every commercial query excluded an order outright
--      when any attempt read 'reversed' — an assumption ("full-refund
--      reversal") the partial path breaks. A 5,000 UGX delivery-fee refund
--      erased a 500,000 UGX order from attributed revenue, margin and cohorts.
--
-- This is ONE canonical refund truth: what was asked for, what it was
-- allocated against, and what the provider finally did. Revenue reversal is
-- computed BY RECOMPUTE from these rows, so it is exactly-once by
-- construction — replaying a settlement can never double-subtract.
--
-- Line allocation is OPTIONAL by design. A refund that belongs to no line
-- (a delivery-fee variance) carries no payment_refund_lines rows and reverses
-- order-level revenue only; it must never be smeared across product lines,
-- because that would invent a per-product refund that never happened.
--
-- ADDITIVE AND REVERSIBLE; no INSERTs. Ships EMPTY: no completed payment has
-- ever existed in this system, so no refund has ever been issued.
--
-- Rollback:
--   DROP TABLE IF EXISTS payment_refund_lines;
--   DROP TABLE IF EXISTS payment_refunds;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "payment_refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "payment_attempt_id" uuid NOT NULL REFERENCES "payment_attempts"("id"),
  "order_id" uuid NOT NULL REFERENCES "orders"("id"),
  -- Supplied by the caller. The unique index below is what makes a retry a
  -- no-op instead of a second payout.
  "idempotency_key" varchar(120) NOT NULL,
  "amount_ugx" bigint NOT NULL,
  "reason" text NOT NULL,
  -- requested → settled | rejected. 'requested' still counts against the
  -- refundable balance: money in flight is not money available to refund again.
  "status" varchar(20) NOT NULL DEFAULT 'requested',
  "provider_status" varchar(60),
  "provider_message" text,
  "requested_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "settled_at" timestamptz,
  CONSTRAINT "payment_refunds_amount_positive" CHECK ("amount_ugx" > 0),
  CONSTRAINT "payment_refunds_status_vocab" CHECK ("status" IN ('requested', 'settled', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_refunds_idempotency_uq" ON "payment_refunds" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_refunds_attempt_idx" ON "payment_refunds" ("payment_attempt_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_refunds_order_idx" ON "payment_refunds" ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_refunds_status_idx" ON "payment_refunds" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_refund_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "refund_id" uuid NOT NULL REFERENCES "payment_refunds"("id") ON DELETE CASCADE,
  "order_item_id" uuid NOT NULL REFERENCES "order_items"("id"),
  "amount_ugx" bigint NOT NULL,
  CONSTRAINT "payment_refund_lines_amount_positive" CHECK ("amount_ugx" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_refund_lines_uq" ON "payment_refund_lines" ("refund_id", "order_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_refund_lines_item_idx" ON "payment_refund_lines" ("order_item_id");
