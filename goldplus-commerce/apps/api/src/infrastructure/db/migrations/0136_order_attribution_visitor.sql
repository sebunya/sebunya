-- 0136 — the visitor behind an order, as GA4 knows it. Payment is confirmed
-- server to server (PesaPal), where no browser is present; the purchase sent to
-- GA4 then carries this client id (the web tag's client_id is the same
-- `_fp_cid` value) and the buyer's IP/browser, so it joins the visit that led
-- to it. Additive, nullable.
ALTER TABLE order_attribution ADD COLUMN IF NOT EXISTS fp_client_id varchar(255);
ALTER TABLE order_attribution ADD COLUMN IF NOT EXISTS client_ip varchar(64);
ALTER TABLE order_attribution ADD COLUMN IF NOT EXISTS user_agent varchar(1024);
