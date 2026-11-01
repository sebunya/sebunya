-- ═══════════════════════════════════════════════════════════════════════════
-- 0098 — Terminal states for orders.reservation_state
--
-- The 0053 vocabulary had NO EXIT: an order whose stock had been released
-- still claimed RESERVED forever — the same entered-never-left trap the
-- payment attempts fell into, on the exact field payment initiation and
-- fulfilment fail closed on. Seven production orders sat in it.
--
-- RELEASED: the stock went back on sale (TTL expiry, abandonment, or an
--           operator-directed release). Payment must not start against it.
-- CONSUMED: the stock was committed to a delivered order.
--
-- ADDITIVE AND REVERSIBLE: the constraint is REPLACED with a strictly wider
-- one; no row changes, no INSERTs.
--
-- Rollback:
--   ALTER TABLE orders DROP CONSTRAINT orders_reservation_state_known;
--   ALTER TABLE orders ADD CONSTRAINT orders_reservation_state_known
--     CHECK (reservation_state IN
--       ('PENDING','RESERVED','BACKORDERED','NOT_REQUIRED','UNRESERVED_BLOCKED'));
--   (legal only after any RELEASED/CONSUMED rows are reverted)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_reservation_state_known";
--> statement-breakpoint
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_reservation_state_known"
  CHECK ("reservation_state" IN
    ('PENDING', 'RESERVED', 'BACKORDERED', 'NOT_REQUIRED', 'UNRESERVED_BLOCKED', 'RELEASED', 'CONSUMED'));
