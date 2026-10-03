-- 0168: the shop's real position (2026-10-03).
--
-- The dispatch origin was imported at 0.313330, 32.577500 ("Uhuru Restaurant,
-- Wilson Road (adjacent premises)", confidence approximate_adjacent_landmark):
-- the restaurant's position, about 100 m south of the shop. Fixed today from
-- the owner's photos taken inside the shop against satellite imagery: the shop
-- is on the 4th floor of the New Pioneer Mall Building, on its Burton Street
-- face at the southern end, looking across Burton Street at the Mapeera
-- building and Amani Mall. The Google Business Profile pin was moved to the
-- same point the same day. Accuracy is the building face (about 10 m).
--
-- Both rows change only if they still hold the values set at import, so an
-- operator edit made since is kept.
UPDATE delivery_origin SET
  name = 'GoldPlus New Pioneer Mall',
  street = 'New Pioneer Mall Building, 4th Floor, Burton Street',
  landmark_primary = 'Next to Uhuru Restaurant',
  landmark_secondary = 'Opposite Pioneer Mall',
  latitude = 0.314220,
  longitude = 32.577920,
  coord_source = 'owner_photos_vs_satellite_2026-10-03',
  coord_anchor = 'Burton Street face of New Pioneer Mall Building, southern end, opposite Ali enterprise / Amani Mall',
  coord_confidence = 'building_face_10m',
  updated_at = now()
WHERE origin_code = 'HUB-CBD-WILSON' AND latitude = 0.313330 AND longitude = 32.577500;
--> statement-breakpoint
UPDATE business_info SET
  config = config || jsonb_build_object(
    'addressLine1', 'New Pioneer Mall Building, 4th Floor, Burton Street, Kampala',
    'addressLine2', 'Opposite Pioneer Mall, next to Uhuru Restaurant.',
    'mapUrl', 'https://maps.google.com/?cid=2567724259551649466'),
  version = version + 1,
  updated_at = now()
WHERE id = true AND config->>'addressLine1' = 'Wilson Road, Kampala';
