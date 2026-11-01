-- 0186: the "sameday" hero slide promises when an order goes OUT, not when it arrives (owner, 2026-10-15).
--
-- "Same day delivery in Kampala and Wakiso" / "we deliver today" was a promise the shop cannot keep everywhere it
-- named: not every Wakiso area is in rider range (bus, multi-day). Delivery contract #10: never a point-in-time
-- promise. Only the retired phrases are rewritten (replace()), so an operator's own wording around them in
-- /admin/homepage/hero is kept, and a row that no longer carries them is untouched. Data-only and idempotent; old
-- code renders the new text as-is.
-- Rollback: set the strings back through /admin/homepage/hero.
UPDATE "hero_slides"
SET "kicker" = 'Same-day dispatch', "updated_at" = now()
WHERE "slide_key" = 'sameday' AND "kicker" = 'Same-day delivery';
--> statement-breakpoint
UPDATE "hero_slides"
SET "headline" = replace("headline", 'and we <em>deliver today</em>', 'and it <em>goes out today</em>'), "updated_at" = now()
WHERE "slide_key" = 'sameday' AND "headline" LIKE '%and we <em>deliver today</em>%';
--> statement-breakpoint
UPDATE "hero_slides"
SET "subcopy" = replace("subcopy", 'Same day delivery in Kampala and Wakiso.', 'Same-day dispatch in Kampala and Wakiso; when it arrives depends on the area.'), "updated_at" = now()
WHERE "slide_key" = 'sameday' AND "subcopy" LIKE '%Same day delivery in Kampala and Wakiso.%';
