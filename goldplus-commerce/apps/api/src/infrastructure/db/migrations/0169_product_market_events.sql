-- 0169: a history of each product's public price, stock status and
-- published state (2026-10-06).
--
-- Why: the Spotify ad rotation (domain/advertising/SpotifyAdRotation.ts) may
-- say "Price drop" only when today's price is below the lowest price of the
-- 30 days before it, "Back in stock" only after a real restock, and "New in"
-- only for a recently published product. Until now the database kept none of
-- that: product_prices holds current values only, and at least three code
-- paths write prices (the product repository, the PIM import, the battery
-- catalogue). So the history is written by a TRIGGER on products, which no
-- code path can bypass.
--
-- One row per change, holding the full snapshot after it. `changed` names what
-- changed. A BASELINE row per existing product marks where history starts: no
-- claim is ever made about the 30 days before it, so price drops can first be
-- proven 30 days after this migration. Public price only (products.price_ugx):
-- never a dealer price, cost or floor.
CREATE TABLE IF NOT EXISTS product_market_events (
  id bigserial PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  price_ugx integer NOT NULL,
  stock_status varchar(30) NOT NULL,
  published boolean NOT NULL,
  changed text[] NOT NULL CHECK (cardinality(changed) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_market_events_product_at_idx ON product_market_events (product_id, at);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_product_market_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pub boolean := (NEW.approval_status = 'approved' AND NEW.active);
  what text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    what := ARRAY['CREATED'];
  ELSE
    IF NEW.price_ugx IS DISTINCT FROM OLD.price_ugx THEN what := what || 'PRICE'; END IF;
    IF NEW.stock_status IS DISTINCT FROM OLD.stock_status THEN what := what || 'STOCK'; END IF;
    IF pub IS DISTINCT FROM (OLD.approval_status = 'approved' AND OLD.active) THEN what := what || 'PUBLISHED'; END IF;
  END IF;
  IF cardinality(what) > 0 THEN
    INSERT INTO product_market_events (product_id, price_ugx, stock_status, published, changed)
    VALUES (NEW.id, NEW.price_ugx, NEW.stock_status, pub, what);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS product_market_events_trg ON products;
--> statement-breakpoint
CREATE TRIGGER product_market_events_trg
  AFTER INSERT OR UPDATE OF price_ugx, stock_status, approval_status, active ON products
  FOR EACH ROW EXECUTE FUNCTION record_product_market_event();
--> statement-breakpoint
INSERT INTO product_market_events (product_id, price_ugx, stock_status, published, changed)
SELECT p.id, p.price_ugx, p.stock_status, (p.approval_status = 'approved' AND p.active), ARRAY['BASELINE']
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM product_market_events e WHERE e.product_id = p.id);
