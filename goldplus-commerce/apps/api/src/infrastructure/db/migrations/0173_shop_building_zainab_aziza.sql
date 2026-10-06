-- 0173: the shop's building is the Zainab Aziza Building (owner, 2026-10-06).
--
-- 0168 fixed the shop's POSITION from the owner's photos (Burton Street face,
-- 4th floor, 0.31422, 32.57792) but named the building "New Pioneer Mall
-- Building". The owner corrected the name: the shop is in the Zainab Aziza
-- Building, opposite Pioneer Mall. Position, floor and landmarks are unchanged.
--
-- Each row changes only if it still holds the value 0168 wrote, so an
-- operator edit made since is kept.
UPDATE delivery_origin SET
  name = 'GoldPlus Zainab Aziza',
  street = 'Zainab Aziza Building, 4th Floor, Burton Street',
  coord_anchor = 'Burton Street face of the Zainab Aziza Building, southern end, opposite Ali enterprise / Amani Mall',
  updated_at = now()
WHERE origin_code = 'HUB-CBD-WILSON' AND street = 'New Pioneer Mall Building, 4th Floor, Burton Street';
--> statement-breakpoint
UPDATE business_info SET
  config = config || jsonb_build_object('addressLine1', 'Zainab Aziza Building, 4th Floor, Burton Street, Kampala'),
  version = version + 1,
  updated_at = now()
WHERE id = true AND config->>'addressLine1' = 'New Pioneer Mall Building, 4th Floor, Burton Street, Kampala';
