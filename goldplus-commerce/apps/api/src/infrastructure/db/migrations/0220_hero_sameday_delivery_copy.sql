-- 0220: owner decision 2026-11-05: the promise is same-day dispatch AND delivery in Kampala and Wakiso on orders before
-- the cut-off (supersedes the dispatch-only wording of 0186, 2026-10-15). Delivery contract guarantee 10 forbids a
-- The headline "goes out today" stays: it is true under the new promise too.
-- point-in-time promise ("by 3pm"), not a same-day one. Only 0186's own phrases are rewritten (replace()), so an
-- operator's own wording in /admin/homepage/hero is kept and a row that no longer carries them is untouched.
-- Data-only and idempotent; old code renders the new text as-is.
-- Rollback: set the strings back through /admin/homepage/hero (or run 0186's three statements again).
UPDATE "hero_slides"
SET "kicker" = 'Same-day delivery', "updated_at" = now()
WHERE "slide_key" = 'sameday' AND "kicker" = 'Same-day dispatch';
--> statement-breakpoint
UPDATE "hero_slides"
SET "subcopy" = replace("subcopy", 'Same-day dispatch in Kampala and Wakiso; when it arrives depends on the area.', 'Same-day dispatch and delivery in Kampala and Wakiso.'), "updated_at" = now()
WHERE "slide_key" = 'sameday' AND "subcopy" LIKE '%Same-day dispatch in Kampala and Wakiso; when it arrives depends on the area.%';
