-- Money columns to bigint, with non-negative CHECK constraints.
--
-- WHY
-- Every monetary column was int4. UGX has no sub-units, so integer amounts are
-- correct — but int4 tops out at 2,147,483,647 UGX (~USD 560k). A single
-- large solar/inverter B2B order or a lifetime-value aggregate can approach
-- that ceiling, and an overflow here would corrupt money, silently, at the
-- worst possible place. JavaScript numbers are exact to 2^53, so bigint in
-- PostgreSQL with number-mode mapping stays lossless for any realistic value
-- while removing the int4 cliff.
--
-- LOCK RISK (documented per release discipline)
-- int4 -> int8 is a table REWRITE under ACCESS EXCLUSIVE. On this system's
-- table sizes (single-shop order volume) the rewrite is sub-second locally;
-- the production MIGRATION_PLAN must schedule it in a quiet window and must
-- not batch it with other DDL. The CHECK constraints are added NOT VALID and
-- validated separately, which takes only a SHARE UPDATE EXCLUSIVE lock during
-- validation, so the constraint step does not extend the exclusive window.
--
-- WHY CHECKS AT ALL
-- The application already refuses negative money, but §7.12's point stands:
-- a bug, a bad import or a manual UPDATE must not be able to write a negative
-- amount that every downstream aggregate then silently absorbs. The database
-- is the last line, so the invariant lives here too.

ALTER TABLE orders
  ALTER COLUMN subtotal_amount TYPE bigint,
  ALTER COLUMN delivery_fee TYPE bigint,
  ALTER COLUMN total_amount TYPE bigint,
  ALTER COLUMN pricing_base_subtotal TYPE bigint,
  ALTER COLUMN pricing_discount_total TYPE bigint,
  ALTER COLUMN pricing_tax_total TYPE bigint;

ALTER TABLE order_items
  ALTER COLUMN unit_price TYPE bigint,
  ALTER COLUMN canonical_unit_price TYPE bigint,
  ALTER COLUMN base_subtotal TYPE bigint,
  ALTER COLUMN discount_amount TYPE bigint,
  ALTER COLUMN final_line_total TYPE bigint;

ALTER TABLE payments
  ALTER COLUMN amount TYPE bigint;

ALTER TABLE payment_attempts
  ALTER COLUMN amount TYPE bigint;

ALTER TABLE delivery_zones
  ALTER COLUMN fee_ugx TYPE bigint;

-- Non-negative money. NOT VALID first so existing rows are not scanned under
-- the exclusive lock; VALIDATE afterwards under the weaker lock. If any
-- existing row violates one of these, VALIDATE fails loudly — which is the
-- correct outcome: that row is a money-corruption finding, not something to
-- paper over.
ALTER TABLE orders
  ADD CONSTRAINT orders_money_non_negative
  CHECK (subtotal_amount >= 0 AND delivery_fee >= 0 AND total_amount >= 0
     AND pricing_base_subtotal >= 0 AND pricing_discount_total >= 0
     AND pricing_tax_total >= 0) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT orders_money_non_negative;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_money_non_negative
  CHECK (unit_price >= 0 AND canonical_unit_price >= 0 AND base_subtotal >= 0
     AND discount_amount >= 0 AND final_line_total >= 0) NOT VALID;
ALTER TABLE order_items VALIDATE CONSTRAINT order_items_money_non_negative;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_quantity_positive
  CHECK (quantity > 0) NOT VALID;
ALTER TABLE order_items VALIDATE CONSTRAINT order_items_quantity_positive;

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_non_negative
  CHECK (amount >= 0) NOT VALID;
ALTER TABLE payments VALIDATE CONSTRAINT payments_amount_non_negative;

ALTER TABLE payment_attempts
  ADD CONSTRAINT payment_attempts_amount_non_negative
  CHECK (amount >= 0) NOT VALID;
ALTER TABLE payment_attempts VALIDATE CONSTRAINT payment_attempts_amount_non_negative;

ALTER TABLE delivery_zones
  ADD CONSTRAINT delivery_zones_fee_non_negative
  CHECK (fee_ugx >= 0) NOT VALID;
ALTER TABLE delivery_zones VALIDATE CONSTRAINT delivery_zones_fee_non_negative;
