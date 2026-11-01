-- 0137 — GA4's own session for the visit behind an order (from the `_ga_<id>`
-- cookie at checkout). A server-sent purchase carrying it joins that session,
-- so the sale is credited to the visit's traffic source instead of direct.
ALTER TABLE order_attribution ADD COLUMN IF NOT EXISTS ga_session_id varchar(32);
ALTER TABLE order_attribution ADD COLUMN IF NOT EXISTS ga_session_number integer;
