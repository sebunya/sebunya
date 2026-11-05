-- 0221: the shop's street is Wilson Road (owner, 2026-11-05: "correct our location to Wilson Road instead of Burton
-- Street"). Building (Zainab Aziza), floor (4th), landmarks (opposite Pioneer Mall, next to Uhuru Restaurant) and the
-- map position are unchanged. Every statement is guarded on the exact value it replaces, so an operator edit made
-- since is kept and a second run changes nothing. Data-only; old code renders the new text as-is.
-- Delivery settings are versioned (contract guarantee 9): if the PUBLISHED version stored the pickup line with
-- Burton Street, a NEW version is published (a copy of every value, pickup line corrected) and the old one is marked
-- superseded, exactly as Admin > Delivery publishes; revert is Admin > Delivery > revert. If it was never stored, the
-- code default (already Wilson Road) is what customers see and nothing is written.
-- Rollback: the reverse replace() of each statement, or edit in /admin/business-info, /admin/homepage/hero, /admin/blog.
UPDATE business_info SET
  config = config || jsonb_build_object('addressLine1', 'Zainab Aziza Building, 4th Floor, Wilson Road, Kampala'),
  version = version + 1,
  updated_at = now()
WHERE id = true AND config->>'addressLine1' = 'Zainab Aziza Building, 4th Floor, Burton Street, Kampala';
--> statement-breakpoint
UPDATE delivery_origin SET
  street = 'Zainab Aziza Building, 4th Floor, Wilson Road',
  updated_at = now()
WHERE origin_code = 'HUB-CBD-WILSON' AND street = 'Zainab Aziza Building, 4th Floor, Burton Street';
--> statement-breakpoint
UPDATE hero_slides SET
  fine_print = replace(fine_print, 'Zainab Aziza Building, Burton Street', 'Zainab Aziza Building, Wilson Road'),
  updated_at = now()
WHERE fine_print LIKE '%Zainab Aziza Building, Burton Street%';
--> statement-breakpoint
-- The shop guide: its address comes from its title, so the row is renamed in place (no second post) and the old
-- address answers with a permanent redirect (blog/[slug].astro reads recorded redirects).
UPDATE blog_posts SET
  slug = 'visiting-the-goldplus-shop-on-wilson-road',
  title = 'Visiting the GoldPlus shop on Wilson Road',
  meta_title = replace(meta_title, 'Burton Street', 'Wilson Road'),
  updated_at = now()
WHERE slug = 'visiting-the-goldplus-shop-on-burton-street'
  AND NOT EXISTS (SELECT 1 FROM blog_posts WHERE slug = 'visiting-the-goldplus-shop-on-wilson-road');
--> statement-breakpoint
UPDATE blog_posts SET
  body = replace(body, 'the shop is on the Burton Street side of the building, between Wilson Road and Burton Street.', 'the shop is on Wilson Road.'),
  updated_at = now()
WHERE body LIKE '%the shop is on the Burton Street side of the building, between Wilson Road and Burton Street.%';
--> statement-breakpoint
UPDATE blog_posts SET
  body = replace(body, 'Burton Street', 'Wilson Road'),
  excerpt = replace(excerpt, 'Burton Street', 'Wilson Road'),
  meta_description = replace(meta_description, 'Burton Street', 'Wilson Road'),
  updated_at = now()
WHERE body LIKE '%Burton Street%' OR excerpt LIKE '%Burton Street%' OR meta_description LIKE '%Burton Street%';
--> statement-breakpoint
INSERT INTO redirects (from_path, to_path, status_code, reason)
VALUES ('/blog/visiting-the-goldplus-shop-on-burton-street', '/blog/visiting-the-goldplus-shop-on-wilson-road', 301, 'shop street is Wilson Road (0221)')
ON CONFLICT (from_path) DO NOTHING;
--> statement-breakpoint
CREATE TEMP TABLE _gp0221_cur ON COMMIT DROP AS
SELECT v.id FROM delivery_config_version v
WHERE v.status = 'published'
  AND EXISTS (SELECT 1 FROM delivery_config_value x WHERE x.version_id = v.id AND x.config_key = 'copy_pickup_offer' AND x.config_value LIKE '%Burton Street%')
ORDER BY v.published_at DESC NULLS LAST LIMIT 1;
--> statement-breakpoint
CREATE TEMP TABLE _gp0221_new ON COMMIT DROP AS SELECT gen_random_uuid() AS id FROM _gp0221_cur;
--> statement-breakpoint
UPDATE delivery_config_version SET status = 'superseded' WHERE status = 'published' AND EXISTS (SELECT 1 FROM _gp0221_new);
--> statement-breakpoint
INSERT INTO delivery_config_version (id, status, reason, published_at)
SELECT id, 'published', '0221: shop street is Wilson Road (pickup line)', now() FROM _gp0221_new;
--> statement-breakpoint
INSERT INTO delivery_config_value (version_id, config_key, config_value, origin, sample_size)
SELECT n.id, x.config_key,
       CASE WHEN x.config_key = 'copy_pickup_offer' THEN replace(x.config_value, 'Burton Street', 'Wilson Road') ELSE x.config_value END,
       x.origin, x.sample_size
FROM _gp0221_new n CROSS JOIN _gp0221_cur c JOIN delivery_config_value x ON x.version_id = c.id;
