-- Inventory: enforce the stock invariant in the database.
--
-- FINDING
-- The inventory domain header states the invariant that prevents overselling:
-- "reserved_quantity is never allowed to exceed stock_quantity, so
-- available = stock_quantity - reserved_quantity is always >= 0".
-- Nothing enforced it. `products` carried no CHECK constraint of any kind, and
-- the invariant was upheld only by arithmetic inside one repository method.
--
-- RISK
-- Every other writer bypassed it. The admin product update writes
-- stock_quantity directly with no knowledge of reserved_quantity, so an
-- operator recording a stock-take could set stock below what was already
-- promised to customers. The result is invisible: computeAvailable() clamps
-- with Math.max(0, ...) and the dispatch deduction clamps with greatest(0, ...),
-- so a corrupt position reads as an ordinary out-of-stock. Orders sit
-- unfulfillable and no alert, report or low-stock list says why. Every clamp in
-- the codebase sits exactly where a violation would otherwise have surfaced.
--
-- CHANGE
-- Two constraints, deliberately given different enforcement strengths.
--
-- 1. Non-negativity, validated immediately. Negative physical stock and
--    negative reservations have no legitimate meaning, so this is enforced in
--    full and existing rows are checked. If the migration fails here the data
--    is already corrupt and must be seen, not worked around.
--
-- 2. reserved_quantity <= stock_quantity, added NOT VALID. It binds every
--    INSERT and UPDATE from this point on — new writes cannot strand a
--    reservation. It is NOT VALID rather than validated because a pre-existing
--    violation is a commercial problem (real customer orders promised against
--    units the business does not hold) that a schema migration is not entitled
--    to resolve by refusing to deploy. Legacy rows are reported by the query at
--    the foot of this file; VALIDATE CONSTRAINT is run separately once they are
--    reconciled. Adding it NOT VALID also avoids the full-table ACCESS
--    EXCLUSIVE scan on a live products table.
--
-- Additive and idempotent. No data is read, moved or discarded.
-- Rollback:
--   ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_stock_non_negative";
--   ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_reserved_within_stock";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_non_negative'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_stock_non_negative"
      CHECK ("stock_quantity" >= 0 AND "reserved_quantity" >= 0);
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_reserved_within_stock'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_reserved_within_stock"
      CHECK ("reserved_quantity" <= "stock_quantity") NOT VALID;
  END IF;
END
$$;
--> statement-breakpoint
-- Legacy violations, if any, are recorded as a warning rather than silently
-- ignored. Each row listed is a product whose reservations exceed its on-hand
-- stock and therefore has customer orders that cannot be fulfilled.
DO $$
DECLARE
  stranded integer;
BEGIN
  SELECT count(*) INTO stranded
  FROM "products"
  WHERE "reserved_quantity" > "stock_quantity";

  IF stranded > 0 THEN
    RAISE WARNING
      'INVENTORY_STRANDED_RESERVATIONS: % product(s) hold reservations exceeding on-hand stock. New writes are now blocked, but these rows predate the constraint. Reconcile them, then run: ALTER TABLE products VALIDATE CONSTRAINT products_reserved_within_stock;',
      stranded;
  END IF;
END
$$;
