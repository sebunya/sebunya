-- Persist the payment mode chosen at checkout so the payment-ops sweeps can
-- target prepaid orders directly instead of inferring from payment attempts.
-- A pay-on-delivery / manual / admin order is unpaid by design and must never
-- be auto-abandoned or have its stock released. Idempotent: additive column,
-- backfill touches only NULLs.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method varchar(20);

-- Backfill: any historical order that has a payment attempt went to online
-- payment. Attemptless legacy orders stay NULL (unknown → never swept, the
-- safe direction).
UPDATE orders SET payment_method = 'pesapal'
 WHERE payment_method IS NULL
   AND EXISTS (SELECT 1 FROM payment_attempts a WHERE a.order_id = orders.id);
