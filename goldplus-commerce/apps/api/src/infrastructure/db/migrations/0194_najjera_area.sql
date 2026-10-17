-- 0194: Najjera becomes its own delivery area (2026-10-17, owner approved).
--
-- Najjera was only a seeded alias of Kira ('wakiso-kira-31340'), whose point is the Kira parish's geometric centre
-- in Kira town: 12.29 km from the shop. Since prices follow measured distance (2026-10-16), every Najjera order was
-- priced 2.6 km too far, and "Locate me" in Najjera never offered Najjera. Najjera is a village inside Kira parish
-- (2016 parishes; data/geo/acceptance-areas.csv), so it has no parish row of its own: it gets one here.
--
-- Point: OpenStreetMap place=village 'Najjeera', node 2099385069 (ODbL, (c) OpenStreetMap contributors), via
-- Nominatim 2026-10-17: 0.3873078, 32.6252306 -> 9.68 km from the shop (band B3, as Kira). A real Najjera order pin
-- sits 0.6 km from it. Also in data/geo/manual-points.csv, so geo:manual-points re-applies the same point.
-- Everything else (zone, corridor, band, access, serviceability, fulfilment) is Kira's, the parish it lies in.
-- The 'Najjera' alias (it folds every spelling: Najjera, Najjeera, Najera, Najeera -> 'najela') now names Najjera.
--
-- Idempotent. Rollback: UPDATE ug_area_alias SET area_slug = 'wakiso-kira-31340' WHERE normalised_alias = 'najela';
-- DELETE FROM delivery_corridor WHERE area_slug = 'wakiso-najjera-31340'; DELETE FROM ug_area WHERE area_slug = 'wakiso-najjera-31340';
SET LOCAL lock_timeout = '5s';

INSERT INTO ug_area (area_slug, postcode, parish_or_area_clean, parish_or_area_source, display_label, current_district,
  district_2019_source, district_changed, region, county_or_municipality, subcounty_or_division, delivery_zone_code,
  selectable, is_metro, search_text, data_version, area_kind, area_kind_source)
SELECT 'wakiso-najjera-31340', k.postcode, 'Najjera', 'Najjera', 'Najjera, Wakiso', k.current_district,
  k.district_2019_source, k.district_changed, k.region, k.county_or_municipality, k.subcounty_or_division, k.delivery_zone_code,
  true, k.is_metro, 'najela wakiso kiadondo kila', k.data_version, 'neighbourhood', 'manual'
FROM ug_area k WHERE k.area_slug = 'wakiso-kira-31340'
ON CONFLICT (area_slug) DO NOTHING;

INSERT INTO delivery_corridor (area_slug, postcode, delivery_zone, district, sub_county_or_division, area, corridor, distance_band,
  access_mode, assignment_confidence, assignment_basis, serviceable, centroid_lat, centroid_lng, centroid_source,
  centroid_sample_size, data_version, fulfilment_mode, centroid_expected_error_m, centroid_source_ref, centroid_shared_polygon,
  centroid_updated_at)
SELECT 'wakiso-najjera-31340', k.postcode, k.delivery_zone, k.district, k.sub_county_or_division, 'Najjera', k.corridor, k.distance_band,
  k.access_mode, k.assignment_confidence, 'area_level', k.serviceable, 0.387308, 32.625231, 'manual',
  0, k.data_version, k.fulfilment_mode, 800, 'osm:node/2099385069', false,
  now()
FROM delivery_corridor k WHERE k.area_slug = 'wakiso-kira-31340'
ON CONFLICT (area_slug) DO NOTHING;

UPDATE ug_area_alias SET area_slug = 'wakiso-najjera-31340',
  note = 'Najjera has its own area since 0194 (was: Kira sub-county locality; heavy residential delivery demand)'
WHERE normalised_alias = 'najela' AND area_slug = 'wakiso-kira-31340'
  AND EXISTS (SELECT 1 FROM ug_area WHERE area_slug = 'wakiso-najjera-31340');
