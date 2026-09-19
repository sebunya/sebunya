-- 0139 — ad-network click ids seen in the 30 days before an order (gclid,
-- msclkid, twclid, ttclid, ScCid, clickid …). Payment is confirmed server to
-- server, so the purchase sent to Google Ads, Microsoft, X or a network
-- postback can only carry the click id if the order kept it. Additive.
ALTER TABLE order_attribution ADD COLUMN IF NOT EXISTS click_ids jsonb;
