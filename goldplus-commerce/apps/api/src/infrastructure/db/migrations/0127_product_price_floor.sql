-- Per-product price floor and preserved price tiers (0127).
--
-- WHY
-- The owner's rule is: the website sells at Price D, and no discount may take a
-- product below its own Price A. The pricing engine already had the right idea —
-- the evaluator holds every line at `priceFloorUgx` — but the floor lived on the
-- PROMOTION, one number for every product. That was fine while the whole shop was
-- eight products priced 145,000–185,000 and the number was 145,000. The real
-- catalogue is 184 products from UGX 4,000 cables to UGX 720,000 memory cards,
-- with a different Price A for each. One global floor cannot express that: it
-- either blocks 90% of the catalogue from being listed at all, or lets a
-- discount cut a cable below cost.
--
-- WHAT
-- `floor_price` is the product's own Price A. `tier_b_price` and `tier_c_price`
-- preserve the workbook's B and C tiers exactly as written so nothing from the
-- owner's price list is lost on import; no surface reads them yet.
--
-- BACKFILL
-- Every product that exists today was listed under the old global rule, so its
-- floor becomes exactly that rule: 145,000. Customers see no change. The live
-- promotion's own floor is then released to 0 by the application so the product
-- floors govern — a promotion may still carry an EXTRA floor of its own.
--
-- A NULL floor means "no floor has been set" and the application treats such a
-- product as NOT discountable — a silently-zero floor is exactly how a storefront
-- comes to advertise a price the basket will not honour.
--
-- MIGRATION_REQUIRED=true. LOCK RISK: three nullable columns and a CHECK on a
-- table with 8 rows; instantaneous.

alter table product_prices add column if not exists floor_price integer;
alter table product_prices add column if not exists tier_b_price integer;
alter table product_prices add column if not exists tier_c_price integer;

-- The rule itself, held by the database: a floor can never sit above the price
-- it floors, and can never be zero or negative.
alter table product_prices drop constraint if exists product_prices_floor_check;
alter table product_prices add constraint product_prices_floor_check
  check (floor_price is null or (floor_price > 0 and floor_price <= retail_price));

update product_prices set floor_price = 145000 where floor_price is null;
