-- 0170: products the owner chooses to advertise (2026-10-06).
--
-- The Spotify rotation advertises a product only for a reason it can prove:
-- a price drop, a restock, a new arrival, or real sales. On 2026-10-06 the
-- shop had none of those (no customer sale in 30 days, nothing added in 21,
-- history only starting), so the rotation could run no ad at all. A product
-- the owner features is a reason in itself; its ad states only the name and
-- today's price, never "new" or "drop". Keyed by platform so other networks
-- can use the same choice later. Every change is audited by the use case.
CREATE TABLE IF NOT EXISTS ad_featured_products (
  platform varchar(40) NOT NULL,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid,
  PRIMARY KEY (platform, product_id)
);
