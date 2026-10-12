-- 0176: record_product_market_event() (0169) failed on every UPDATE it was
-- meant to record. `what || 'PRICE'` resolves the untyped literal as text[]
-- (array || array), so Postgres tried to parse 'PRICE' as an array literal:
--   malformed array literal: "PUBLISHED" ... where: record_product_market_event() line 11
-- Seen 2026-10-12 when drafting 111 products (PRODUCTS_BULK_APPROVAL); the same
-- trigger guards price, stock-status and approval changes, so those UPDATEs
-- raised too. array_append() is unambiguous. Trigger definition unchanged.
CREATE OR REPLACE FUNCTION record_product_market_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pub boolean := (NEW.approval_status = 'approved' AND NEW.active);
  what text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    what := ARRAY['CREATED'];
  ELSE
    IF NEW.price_ugx IS DISTINCT FROM OLD.price_ugx THEN what := array_append(what, 'PRICE'); END IF;
    IF NEW.stock_status IS DISTINCT FROM OLD.stock_status THEN what := array_append(what, 'STOCK'); END IF;
    IF pub IS DISTINCT FROM (OLD.approval_status = 'approved' AND OLD.active) THEN what := array_append(what, 'PUBLISHED'); END IF;
  END IF;
  IF cardinality(what) > 0 THEN
    INSERT INTO product_market_events (product_id, price_ugx, stock_status, published, changed)
    VALUES (NEW.id, NEW.price_ugx, NEW.stock_status, pub, what);
  END IF;
  RETURN NEW;
END $$;
