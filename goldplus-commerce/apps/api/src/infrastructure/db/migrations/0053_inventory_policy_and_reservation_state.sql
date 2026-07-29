-- Inventory must fail closed: selling policy per product, reservation state per order.
--
-- FINDING
-- Reservation was best-effort by contract: "a failure here must not fail the
-- order". The checkout route caught every error from the reservation call and
-- converted it into an ON_HOLD backorder. A deadlock was only one way in — a
-- statement timeout, a dropped connection, a serialization failure or any
-- unexpected repository error produced the same result.
--
-- RISK
-- A technical failure and a genuine stock shortage became indistinguishable. The
-- order was recorded as backordered, the same units stayed available to the next
-- customer, and nothing downstream could tell whether stock had actually been
-- held. There was also no notion of WHICH products may legitimately be sold
-- without stock, so every product was implicitly backorderable.
--
-- CHANGE
-- 1. products.inventory_policy — the selling policy for the product:
--      STOCK_CONTROLLED  reservation must succeed or the order does not proceed
--      BACKORDER_ALLOWED may be sold unreserved, recorded truthfully as such
--      NON_STOCK_ITEM    reservation does not apply (services, digital)
--    Defaults to STOCK_CONTROLLED: the safe reading of an unmigrated row is that
--    it must be reserved, never that it may be oversold.
--
-- 2. orders.reservation_state — what actually happened to stock for this order,
--    recorded on the order itself rather than inferred from a fulfilment task:
--      RESERVED             every stock-controlled line is held
--      BACKORDERED          only backorder-eligible lines went unreserved
--      NOT_REQUIRED         no line needed a reservation
--      UNRESERVED_BLOCKED   reservation failed; the order must not progress
--      PENDING              reservation has not been attempted yet
--    Defaults to PENDING for new rows. Existing rows are backfilled to
--    RESERVED only where an active reservation actually exists; everything else
--    becomes NOT_REQUIRED rather than being asserted as reserved.
--
-- Additive and idempotent. No data is read, moved or discarded.
-- Rollback:
--   ALTER TABLE "products" DROP COLUMN IF EXISTS "inventory_policy";
--   ALTER TABLE "orders" DROP COLUMN IF EXISTS "reservation_state";
--   ALTER TABLE "orders" DROP COLUMN IF EXISTS "reservation_updated_at";

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "inventory_policy" varchar(24) NOT NULL DEFAULT 'STOCK_CONTROLLED';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_inventory_policy_known') THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_inventory_policy_known"
      CHECK ("inventory_policy" IN ('STOCK_CONTROLLED', 'BACKORDER_ALLOWED', 'NON_STOCK_ITEM'));
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "reservation_state" varchar(24) NOT NULL DEFAULT 'PENDING';
--> statement-breakpoint
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "reservation_updated_at" timestamp with time zone;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_reservation_state_known') THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_reservation_state_known"
      CHECK ("reservation_state" IN
        ('PENDING', 'RESERVED', 'BACKORDERED', 'NOT_REQUIRED', 'UNRESERVED_BLOCKED'));
  END IF;
END
$$;
--> statement-breakpoint
-- Backfill: an order is asserted RESERVED only where a reservation row proves it.
-- Historical orders with no reservation are marked NOT_REQUIRED rather than
-- RESERVED, because claiming stock was held when no record says so would be a
-- fabrication, and rather than UNRESERVED_BLOCKED because blocking already
-- dispatched history would be false too.
UPDATE "orders" o
SET "reservation_state" = 'RESERVED',
    "reservation_updated_at" = now()
WHERE o."reservation_state" = 'PENDING'
  AND EXISTS (
    SELECT 1 FROM "inventory_reservations" r
    WHERE r."order_id" = o."id" AND r."status" IN ('reserved', 'consumed')
  );
--> statement-breakpoint
UPDATE "orders"
SET "reservation_state" = 'NOT_REQUIRED',
    "reservation_updated_at" = now()
WHERE "reservation_state" = 'PENDING';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_reservation_state_idx"
  ON "orders" ("reservation_state");
--> statement-breakpoint
-- Operational visibility: orders whose stock could not be confirmed. An order in
-- this state must not be presented as payable or fulfilment-ready.
CREATE INDEX IF NOT EXISTS "orders_unreserved_blocked_idx"
  ON "orders" ("created_at")
  WHERE "reservation_state" = 'UNRESERVED_BLOCKED';
