-- 0128 — the merchant feed is opt-OUT, not opt-in.
--
-- products.is_feed_eligible defaulted to false and NOTHING in the codebase ever
-- set it: no admin control, no import path, no script. The Google Merchant feed
-- (/seo/merchant-feed.xml) was therefore structurally empty for every product
-- ever created. A sellable product is listed unless the owner excludes it; the
-- feed use case still requires approved + active + a price + an image.
-- Idempotent and additive: re-running changes nothing.
alter table products alter column is_feed_eligible set default true;
update products set is_feed_eligible = true where is_feed_eligible = false;
