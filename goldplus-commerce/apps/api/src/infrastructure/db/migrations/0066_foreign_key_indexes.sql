-- P0-2 §5 — foreign-key indexes.
--
-- WHY
-- order_items.order_id, cart_items.cart_id, product_prices.product_id and
-- products.category_id are join/lookup keys with no index — every order-detail
-- read, cart read and price lookup was a sequential scan that degrades linearly
-- with table growth. These are the hot read paths. Additive, IF NOT EXISTS.
--
-- LOCK RISK: CREATE INDEX takes a SHARE lock (blocks writes to that table
-- briefly). For a single-shop volume this is sub-second; the production
-- MIGRATION_PLAN may use CREATE INDEX CONCURRENTLY out-of-band for the largest
-- tables. Kept plain here so it applies inside the migration transaction on the
-- current volumes.

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS cart_items_cart_id_idx ON cart_items (cart_id);
CREATE INDEX IF NOT EXISTS product_prices_product_id_idx ON product_prices (product_id);
CREATE INDEX IF NOT EXISTS products_category_id_idx ON products (category_id);
