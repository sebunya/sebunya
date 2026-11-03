-- Probe carts (2026-11-03). Every automated journey that adds to the basket — the five-minute synthetic
-- monitor, the post-deploy compatibility smoke (eight Playwright specs across engines), Lighthouse Watch,
-- the load rehearsals — left a guest cart that looked like a customer: 238 of 245 "carts with items" and
-- most of the 198 "abandoned baskets" a week on production, against 16 product-page views. A cart created
-- by declared automation is now marked, excluded from the abandonment sweep, basket reminders, the sales
-- funnel and the Outcomes page, and deleted by the hourly scan once it is an hour old.
ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "is_probe" boolean NOT NULL DEFAULT false;
