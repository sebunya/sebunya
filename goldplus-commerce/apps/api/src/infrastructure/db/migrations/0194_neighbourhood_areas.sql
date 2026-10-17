-- 0194: neighbourhoods customers name get their own delivery areas and points (2026-10-17, owner approved).
--
-- 28 names customers type were aliases of a larger parish area, whose point is that parish's geometric centre.
-- Since fees follow measured distance (2026-10-16: distance_source = measured), a neighbourhood far from its
-- parish's centre was priced from the wrong place, and "Locate me" there never offered it. Measured from the shop
-- (HUB-CBD-WILSON), each moved name's own OpenStreetMap point differs from its parish's by 0.75 km or more (about
-- UGX 500 at today's rates); those 16 become areas of their own here:
--   Bulenga    was wakiso-nabbingo-31436          10.93 km ->  8.36 km
--   Bunga      was kampala-buziga-10418            9.26 km ->  6.58 km
--   Bwebajja   was wakiso-kitende-31426           13.97 km -> 16.17 km
--   Kajjansi   was wakiso-kitende-31426           13.97 km -> 12.18 km
--   Kalerwe    was kampala-kyebando-10204          4.84 km ->  3.94 km
--   Kasangati  was wakiso-nangabo-31327           14.97 km -> 14.05 km
--   Kawuku     was wakiso-bweya-31425             14.94 km -> 20.18 km
--   Kigowa     was kampala-ntinda-10302            5.75 km ->  6.59 km
--   Kisaasi    was kampala-kyanja-10323            8.51 km ->  5.93 km
--   Kulambiro  was kampala-kyanja-10323            8.51 km ->  7.53 km
--   Lubowa     was wakiso-bunamwaya-31346          7.02 km ->  8.06 km
--   Naalya     was wakiso-kyaliwajala-31341       11.62 km ->  9.17 km
--   Najjera    was wakiso-kira-31340              12.29 km ->  9.68 km
--   Namanve    was mukono-nantabulirwa-31205      13.84 km -> 12.27 km
--   Namasuba   was wakiso-bunamwaya-31346          7.02 km ->  5.04 km
--   Zana       was wakiso-kitende-31426           13.97 km ->  6.99 km
-- The other 12 keep their parish: under 0.6 km apart (Kansanga, Nsambya, Seeta, Matugga, Muyenga, Namugongo,
-- Kinawataka, Munyonyo, Bugolobi), the same place (Lubaga = Rubaga, Nakivubo Shauriyako), or no OpenStreetMap place
-- found (Garuga, on a hand-placed Nalugala point already).
--
-- Najjera (often spelled Najjeera) is a fast-growing residential and commercial neighbourhood in Kira Municipality,
-- Wakiso District (owner, 2026-10-17); the 2016 parish data has no row of its own for it or for the others.
--
-- Each new area copies its parish's zone, district, corridor, band, access, serviceability and fulfilment (the band
-- is the team's hand-set road judgement; the fee follows the measured point; the band-agreement report flags any a
-- person should review). Point: the OpenStreetMap place node (ODbL, (c) OpenStreetMap contributors) via Nominatim
-- 2026-10-17, centroid_source 'manual' so neither the parish import nor the nightly job overwrites it; also in
-- data/geo/manual-points.csv. Search text is built as the gazetteer importer builds it. The customer's name (the
-- alias row, matched by its folded form and old parish) now names the new area.
--
-- Idempotent. Rollback (in one transaction):
--   UPDATE ug_area_alias a SET area_slug = r.parent FROM (VALUES ('wakiso-bulenga-31436','wakiso-nabbingo-31436'), ('kampala-bunga-10418','kampala-buziga-10418'), ('wakiso-bwebajja-31426','wakiso-kitende-31426'), ('wakiso-kajjansi-31426','wakiso-kitende-31426'), ('kampala-kalerwe-10204','kampala-kyebando-10204'), ('wakiso-kasangati-31327','wakiso-nangabo-31327'), ('wakiso-kawuku-31425','wakiso-bweya-31425'), ('kampala-kigowa-10302','kampala-ntinda-10302'), ('kampala-kisaasi-10323','kampala-kyanja-10323'), ('kampala-kulambiro-10323','kampala-kyanja-10323'), ('wakiso-lubowa-31346','wakiso-bunamwaya-31346'), ('wakiso-naalya-31341','wakiso-kyaliwajala-31341'), ('wakiso-najjera-31340','wakiso-kira-31340'), ('mukono-namanve-31205','mukono-nantabulirwa-31205'), ('wakiso-namasuba-31346','wakiso-bunamwaya-31346'), ('wakiso-zana-31426','wakiso-kitende-31426')) r(slug, parent) WHERE a.area_slug = r.slug;
--   DELETE FROM delivery_corridor WHERE area_slug IN ('wakiso-bulenga-31436', 'kampala-bunga-10418', 'wakiso-bwebajja-31426', 'wakiso-kajjansi-31426', 'kampala-kalerwe-10204', 'wakiso-kasangati-31327', 'wakiso-kawuku-31425', 'kampala-kigowa-10302', 'kampala-kisaasi-10323', 'kampala-kulambiro-10323', 'wakiso-lubowa-31346', 'wakiso-naalya-31341', 'wakiso-najjera-31340', 'mukono-namanve-31205', 'wakiso-namasuba-31346', 'wakiso-zana-31426');
--   DELETE FROM ug_area WHERE area_slug IN ('wakiso-bulenga-31436', 'kampala-bunga-10418', 'wakiso-bwebajja-31426', 'wakiso-kajjansi-31426', 'kampala-kalerwe-10204', 'wakiso-kasangati-31327', 'wakiso-kawuku-31425', 'kampala-kigowa-10302', 'kampala-kisaasi-10323', 'kampala-kulambiro-10323', 'wakiso-lubowa-31346', 'wakiso-naalya-31341', 'wakiso-najjera-31340', 'mukono-namanve-31205', 'wakiso-namasuba-31346', 'wakiso-zana-31426');
SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS gp_0194_areas;
CREATE TEMP TABLE gp_0194_areas (slug text, name text, norm text, parent text, lat numeric, lng numeric, ref text, search text) ON COMMIT DROP;
INSERT INTO gp_0194_areas VALUES
  ('wakiso-bulenga-31436', 'Bulenga', 'bulenga', 'wakiso-nabbingo-31436', 0.321600, 32.503120, 'osm:node/2229101503', 'bulenga wakiso nsangi'),
  ('kampala-bunga-10418', 'Bunga', 'bunga', 'kampala-buziga-10418', 0.273020, 32.620460, 'osm:node/9626452678', 'bunga kampala makindye'),
  ('wakiso-bwebajja-31426', 'Bwebajja', 'bwebaja', 'wakiso-kitende-31426', 0.173840, 32.540130, 'osm:node/2099385848', 'bwebaja wakiso sisa'),
  ('wakiso-kajjansi-31426', 'Kajjansi', 'kajansi', 'wakiso-kitende-31426', 0.210540, 32.542670, 'osm:node/292850770', 'kajansi wakiso sisa'),
  ('kampala-kalerwe-10204', 'Kalerwe', 'kalelwe', 'kampala-kyebando-10204', 0.349175, 32.571953, 'osm:node/9626425967', 'kalelwe kampala kawempe'),
  ('wakiso-kasangati-31327', 'Kasangati', 'kasangati', 'wakiso-nangabo-31327', 0.437682, 32.604922, 'osm:node/2229110955', 'kasangati wakiso kiadondo nangabo'),
  ('wakiso-kawuku-31425', 'Kawuku', 'kawuku', 'wakiso-bweya-31425', 0.137420, 32.536900, 'osm:node/3699063074', 'kawuku wakiso sisa'),
  ('kampala-kigowa-10302', 'Kigowa', 'kigowa', 'kampala-ntinda-10302', 0.361730, 32.613281, 'osm:node/2321067285', 'kigowa kampala nakawa'),
  ('kampala-kisaasi-10323', 'Kisaasi', 'kisasi', 'kampala-kyanja-10323', 0.362900, 32.599730, 'osm:node/1152720978', 'kisasi kampala nakawa'),
  ('kampala-kulambiro-10323', 'Kulambiro', 'kulambilo', 'kampala-kyanja-10323', 0.374401, 32.608931, 'osm:node/1152720979', 'kulambilo kampala nakawa'),
  ('wakiso-lubowa-31346', 'Lubowa', 'lubowa', 'wakiso-bunamwaya-31346', 0.246190, 32.552800, 'osm:node/9635318459', 'lubowa wakiso kiadondo sabagabo makindye'),
  ('wakiso-naalya-31341', 'Naalya', 'nalya', 'wakiso-kyaliwajala-31341', 0.372470, 32.636310, 'osm:way/44624568', 'nalya wakiso kiadondo kila'),
  ('wakiso-najjera-31340', 'Najjera', 'najela', 'wakiso-kira-31340', 0.387308, 32.625231, 'osm:node/2099385069', 'najela wakiso kiadondo kila'),
  ('mukono-namanve-31205', 'Namanve', 'namanve', 'mukono-nantabulirwa-31205', 0.354380, 32.680660, 'osm:node/294001837', 'namanve mukono goma'),
  ('wakiso-namasuba-31346', 'Namasuba', 'namasuba', 'wakiso-bunamwaya-31346', 0.269800, 32.569100, 'osm:node/9645641063', 'namasuba wakiso kiadondo sabagabo makindye'),
  ('wakiso-zana-31426', 'Zana', 'zana', 'wakiso-kitende-31426', 0.253570, 32.561220, 'osm:node/2321520478', 'zana wakiso sisa');

INSERT INTO ug_area (area_slug, postcode, parish_or_area_clean, parish_or_area_source, display_label, current_district,
  district_2019_source, district_changed, region, county_or_municipality, subcounty_or_division, delivery_zone_code,
  selectable, is_metro, search_text, data_version, area_kind, area_kind_source)
SELECT n.slug, p.postcode, n.name, n.name, n.name || ', ' || p.current_district, p.current_district,
  p.district_2019_source, p.district_changed, p.region, p.county_or_municipality, p.subcounty_or_division, p.delivery_zone_code,
  true, p.is_metro, n.search, p.data_version, 'neighbourhood', 'manual'
FROM gp_0194_areas n JOIN ug_area p ON p.area_slug = n.parent
ON CONFLICT (area_slug) DO NOTHING;

INSERT INTO delivery_corridor (area_slug, postcode, delivery_zone, district, sub_county_or_division, area, corridor, distance_band,
  access_mode, assignment_confidence, assignment_basis, serviceable, centroid_lat, centroid_lng, centroid_source,
  centroid_sample_size, data_version, fulfilment_mode, centroid_expected_error_m, centroid_source_ref, centroid_shared_polygon,
  centroid_updated_at)
SELECT n.slug, p.postcode, p.delivery_zone, p.district, p.sub_county_or_division, n.name, p.corridor, p.distance_band,
  p.access_mode, p.assignment_confidence, 'area_level', p.serviceable, n.lat, n.lng, 'manual',
  0, p.data_version, p.fulfilment_mode, 800, n.ref, false, now()
FROM gp_0194_areas n JOIN delivery_corridor p ON p.area_slug = n.parent
WHERE EXISTS (SELECT 1 FROM ug_area WHERE area_slug = n.slug)
ON CONFLICT (area_slug) DO NOTHING;

UPDATE ug_area_alias a SET area_slug = n.slug,
  note = 'Own area since 0194 (was ' || n.parent || '): ' || coalesce(a.note, '')
FROM gp_0194_areas n
WHERE a.normalised_alias = n.norm AND a.area_slug = n.parent
  AND EXISTS (SELECT 1 FROM delivery_corridor c WHERE c.area_slug = n.slug);
