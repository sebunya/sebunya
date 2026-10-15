-- 0188: the home page trust strip promises when an order goes OUT, not when it arrives (owner, 2026-10-15), as 0186
-- did for the hero slide. The stored strip (edited in /admin/homepage) said "Get it today" / "Order before 5 PM for
-- same-day delivery in Kampala & Wakiso"; not every Wakiso area is in rider range (delivery contract #10). Only those
-- exact phrases are replaced; everything else in the document is kept, and a document without them is untouched.
-- Data-only, idempotent. Rollback: edit the strip back in /admin/homepage.
UPDATE "homepage_content"
SET "config" = replace(replace("config"::text, 'same-day delivery in Kampala', 'same-day dispatch in Kampala'), '"Get it today"', '"Goes out today"')::jsonb,
    "version" = "version" + 1,
    "updated_at" = now()
WHERE "config"::text LIKE '%same-day delivery in Kampala%' OR "config"::text LIKE '%"Get it today"%';
