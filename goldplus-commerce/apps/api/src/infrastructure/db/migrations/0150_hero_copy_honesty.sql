-- Hero copy honesty (2026-09-24, owner: "fix everything, I trust your call").
--
-- Four seeded hero strings stated things that are not true:
--   loyalty     "member pricing" (no such price rule) and "every warranty you
--               own in one place" (no account page lists warranties);
--   sameday     "Next day everywhere else" (upcountry goes by bus to a parcel
--               office, docs/delivery/MODEL.md 3.6a) and a fine print that
--               hard-coded "5:00pm, Monday to Saturday" beside the operator's
--               business_info cutoff;
--   newarrivals "New this month" / "Restocked weekly" (nothing checks either).
--
-- Each row changes ONLY while its text still equals the old seed, so an
-- operator's own edit in /admin/homepage/hero is never overwritten. Idempotent
-- and data-only: no schema change, and the old code renders the new text as-is.
-- The fine print carries NO {cutoff} token: the code that fills it arrives only
-- with this release, so between migrate and roll (and after a rollback) the
-- live hero would have shown the literal token. library.ts keeps {cutoff} for
-- new seeds, which only new code writes.
-- Rollback: set the four strings back through /admin/homepage/hero.
UPDATE "hero_slides"
SET "subcopy" = 'Points on every delivered order, and your balance and history in one place.', "updated_at" = now()
WHERE "slide_key" = 'loyalty'
  AND "subcopy" = 'Points on every order, member pricing, and every warranty you own in one place.';
--> statement-breakpoint
UPDATE "hero_slides"
SET "subcopy" = 'Same day delivery in Kampala and Wakiso. Upcountry orders go by bus to a parcel office for collection.', "updated_at" = now()
WHERE "slide_key" = 'sameday'
  AND "subcopy" = 'Same day delivery in Kampala and Wakiso. Next day everywhere else.';
--> statement-breakpoint
UPDATE "hero_slides"
SET "fine_print" = 'Order before the cut-off on days the shop is open', "updated_at" = now()
WHERE "slide_key" = 'sameday'
  AND "fine_print" = 'Cut-off 5:00pm, Monday to Saturday';
--> statement-breakpoint
UPDATE "hero_slides"
SET "headline" = 'New lines, <em>verified on arrival</em>', "updated_at" = now()
WHERE "slide_key" = 'newarrivals'
  AND "headline" = 'New this month, <em>verified on arrival</em>';
--> statement-breakpoint
UPDATE "hero_slides"
SET "fine_print" = '', "updated_at" = now()
WHERE "slide_key" = 'newarrivals'
  AND "fine_print" = 'Restocked weekly';
