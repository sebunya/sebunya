-- ═══════════════════════════════════════════════════════════════════════════
-- 0105 — The indexes every commercial query already needed (2026-08-07)
--
-- At 20 orders a sequential scan is free, which is exactly why these were easy
-- to miss: every commercial report is instant today and would stay instant
-- right up until it wasn't. Each index below serves a join or filter that runs
-- on EVERY commercial read.
--
--   payment_attempts.order_id  — unindexed FK. The refund ledger joins it, and
--                                the paid-truth checks look up attempts by
--                                order on every revenue query.
--   orders (payment_status, created_at) — the paid-order filter, in that order
--                                because payment_status is the selective half.
--   orders.status              — fulfilled/completed funnel stages.
--   orders.user_id             — unindexed FK; the cohort query joins it.
--   order_items.product_id     — unindexed FK, and the attribution join key
--                                (order line -> touched product). order_id is
--                                deliberately NOT here: 0066 already indexes
--                                it, and a second index on the same column
--                                only gives the planner a worse choice.
--   recommendation_events (profile_id, recommendation_product_id, created_at)
--                              — the attribution join itself: same profile,
--                                same product, inside the window. The existing
--                                single-column indexes each rule out only one
--                                of the three.
--
-- CREATE INDEX IF NOT EXISTS is not concurrent, so these take a brief lock on
-- tables that are small today. Deliberate: at this size the lock is
-- milliseconds, and CONCURRENTLY cannot run inside the migration transaction.
--
-- ADDITIVE AND REVERSIBLE; no INSERTs; no behaviour change, only plans.
--
-- Rollback: DROP INDEX IF EXISTS each name below.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "payment_attempts_order_idx" ON "payment_attempts" ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_payment_status_created_idx" ON "orders" ("payment_status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_user_idx" ON "orders" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_product_idx" ON "order_items" ("product_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_attribution_join_idx"
  ON "recommendation_events" ("profile_id", "recommendation_product_id", "created_at");
