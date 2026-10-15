# Kampala Metropolitan Address System — specification

Version 1, 2026-10-15. Research and design for making delivery locations, and therefore delivery fees, more
accurate on shopgoldplus.com. Written for a coding assistant or engineer to build from.

**Read these first and keep them in context:** `docs/delivery/CONTRACT.md` (the ten guarantees; nothing below
breaks them), `docs/location-module-brief.md` (PART L: never make a paid geocoder a dependency; never invent fees
or centroids), `docs/delivery/MODEL.md` (the minutes model this feeds).

**What this spec is:** the coordinate, landmark and distance layer that the existing module was designed to receive
("OSM centroids" is already a Phase 2 item in `docs/delivery/OPERATIONS.md` PART 7). It adds accuracy underneath the
model that exists. **What it is not:** a rewrite of the gazetteer, the quoting service, the Control Centre, the
checkout picker or the corridor data. Every one of those is kept and extended.

---

## 0. The one-paragraph version

The shop already has a 5,805-area national gazetteer, a 362-area Kampala-metro set with corridors and distance bands,
a minutes-based fee model, and a Control Centre to run it. Two things stop it from quoting accurately today: no area
has a coordinate, so every distance is a band midpoint (bands are 2–25 km wide); and the six launch numbers are unset,
so every quote falls back to "confirmed by phone". This spec (1) gives every metro area a measured point and a road
distance from the shop, (2) adds a landmark registry so a customer can point at a school, church, stage, mall or petrol
station instead of typing directions, (3) records how accurate each order's location is, and (4) feeds measured
kilometres into the existing model. It uses only open data and the shop's own delivered pins, with paid map APIs as
optional, cached enrichment that can be switched off.

---

## 1. What exists today (verified in the code on 2026-10-15)

| Layer | What is there | Where |
|---|---|---|
| Gazetteer | `ug_area` 5,805 areas / 135 districts (Ministry of ICT draft postcodes, April 2019), `ug_area_alias` 28, groups, exceptions 255, trigram search, offline index (390 metro entries) | `apps/api/src/infrastructure/db/schema/locations.ts`, migration 0084, `scripts/import-locations.ts` |
| Metro delivery set | `delivery_corridor` 362 areas: 14 corridors, bands B0–B6, access road/water, `centroid_lat/lng` columns **never written** | migrations 0092–0096, `scripts/import-delivery.ts` |
| Origin | `delivery_origin` HUB `GoldPlus Zainab Aziza`, 0.314220, 32.577920 (±10 m) | migrations 0168, 0173 |
| Fee model | `expected_minutes = handling + travel(band midpoint × 2 × detour / speed × factors) + last_mile`; fee = `max(min_fee, cost_per_minute × minutes × margin)`; window from percentiles | `domain/delivery/DeliveryModel.ts`, `DeliveryQuoteService.ts` |
| Quoting entry points | `POST /delivery/quote`, `GET /commerce/delivery-estimate`, `CheckoutUseCase` | `interfaces/http/routes/delivery.ts`, `routes/commerce.ts` |
| Config | versioned `delivery_config_value`, learned factors, calibration proposals, Control Centre + launch wizard | `admin/delivery/*.astro`, `DeliveryConfigRegistry.ts` |
| Addresses | `addresses` widened with `area_slug`, `landmark_text`, `gps_lat/lng/accuracy/source`, `resolution_status`, `pickup_point_id` | migration 0084 |
| Landmarks | `ug_landmark` (area_slug, name, type, usage_count, verified, gps) — **admin-written only, 0 rows from checkout** | `DrizzleLocationAdminRepository.ts` |
| Pickup points | `ug_pickup_point` with GPS, hours, carrier — **no rows seeded** | migration 0084, 0093 |
| Bus / upcountry | 128 towns on 9 routes; `delivery_bus_rate_card` — **0 cards, no write path** | `scripts/import-bus-destinations.ts` |
| Checkout | `UgandaLocationPicker` (server search + offline fallback + district browse + manual text + GPS/pasted-link pin); one free-text "Exact address" field doubles as the landmark | `components/UgandaLocationPicker.astro`, `lib/locationPickerClient.ts`, `pages/checkout.astro` |
| Order storage | `orders.delivery_area`, `delivery_address` (the landmark text), `delivery_location` jsonb (district, areaSlug, gps*), `delivery_fee`, `delivery_fee_confirmed` | `schema/commerce.ts` |

**Why quotes are inaccurate today (root causes, in order):**
1. `measuredKm` is always null (`DeliveryAreaResolver.ts` 70/85/138); `haversineKm` has no callers. Every travel estimate uses the band midpoint. B4 is 15–25 km, so two areas in the same band are priced identically even if one is 10 km further.
2. The five mandatory launch values and `own_rider_max_band` are unset → `CONFIG_INCOMPLETE` → legacy `delivery_zones` (empty) → "Confirmed by phone before dispatch".
3. Checkout never passes `hasPin`; `delivery_quote_capture.had_pin` is never set; pins are not fed back into centroids.
4. The landmark lives inside a free-text field, so it cannot be matched to a point.

Everything else in this spec is about fixing those four.

---

## 2. Corrections to the research document

The research note ("Strategic Geospatial Architecture…", 2026) is right about the shape of the problem and the
PostGIS patterns. Three of its data claims do not hold; the design below works around them.

1. **Electoral Commission polling stations have no coordinates.** The Kalulu repository (`Uganda-Open-Data/kalulu`,
   last updated 2026-05-01) holds `voter_register_summary_2020.csv`: 34,684 stations with district, constituency,
   sub-county, parish, station name and voter count. **No latitude/longitude.** The station names are still valuable
   (they name real schools, churches, mosques, LC1 offices and grounds), but each must be matched to a point from OSM
   or GeoNames, or it stays an area-level label.
2. **The HDX COD-AB boundaries stop at sub-county.** `cod-ab-uga` (UBOS with WHO, reviewed 2026-09-21, CC BY-IGO):
   Admin 1 = 4 regions, Admin 2 = 135 districts, Admin 3 = 203 (county/municipality level), Admin 4 = 1,520
   (sub-county level, 2020 boundaries). There are **no parish or village polygons**, so a "village centroid from the
   polygon" cannot come from this source. Parish points come from GeoNames and OSM instead.
3. **Boda stages are barely mapped in OSM.** `amenity=taxi` inside the Greater Kampala bounding box returns **82**
   objects (75 nodes, 7 ways) on 2026-10-15. Stages will come mostly from the shop's own riders and customers, not
   from OSM.

Also: production Postgres is `postgres:16-alpine` with no PostGIS. The schema below runs on plain Postgres 16 with the
`cube`/`earthdistance` contrib extensions (present in the alpine image) and has a defined upgrade path to PostGIS.

---

## 3. Data sources (what each one actually gives us)

Measured on 2026-10-15. "GKMA box" = lat −0.05…0.60, lon 32.30…32.95 (Kampala, Wakiso, Mukono town, Entebbe, Mpigi
town). Licences matter because the data ends up inside a commercial database; see §12.

### 3.1 Ministry of ICT draft postcodes, April 2019 (already imported)
5,805 areas, 135 districts, with parish/area names, sub-county/division, county, region. No coordinates. This remains
the **primary key space** (`area_slug`). Nothing replaces it.

### 3.2 GeoNames Uganda dump (`download.geonames.org/export/dump/UG.zip`, 0.7 MB, CC BY 4.0)
26,943 features with WGS84 coordinates. 11,455 populated places (PPL), 2,215 ADM5 (parish-level), 1,359 ADM4
(sub-county-level), 1,270 schools (SCH), 642 HSPC, 78 HSP, 88 missions.
Inside the GKMA box: 1,205 PPL, 118 ADM5, 44 ADM4, 27 HSPC, 12 HSP, 9 SCH.
Sample PPL names in Kampala (0.25…0.42, 32.50…32.68): Bakuli, Bugolobi, Bukoto, Bunga, Butabika, Bwaise,
Bweyogerere, Ggaba, Kabowa, Kansanga, Katwe, Kawempe, Kazo, Kibuye, Kikaaya, Kinawataka, … (160 places).
Sample ADM5: Bwaise I, Kabalagala, Kanyanya, Kawempe II, Kibuli, Kireka, Kyaliwajala, Kyanja, Makerere III,
Mulago II, Mutundwe, Naguru Godown, Najjanankumbi II, Ndeeba, Wabigalo.
**Use:** first-pass centroid for `ug_area` rows by name match within district (expect ~70–85% of the 362 metro areas to
match directly; the rest via OSM or manual pin).
**Caveat:** GeoNames points are settlement labels, not polygon centroids; accuracy is typically 200 m–1 km. Good
enough for a band and a road distance; not for a door.

### 3.3 OpenStreetMap (ODbL)
Access: Overpass API (public mirrors: `overpass-api.de` was unreachable from this network; `overpass.kumi.systems`,
`overpass.private.coffee`, `maps.mail.ru/osm/tools/overpass` answered, with rate limits), or the Geofabrik extract
`download.geofabrik.de/africa/uganda-latest.osm.pbf` for bulk work (process offline with `osmium`).
Counts inside the GKMA box (nodes+ways+relations):

| Tag | Count | Note |
|---|---|---|
| amenity=school | 2,430 | best landmark class |
| amenity=place_of_worship | 622 | churches, mosques |
| amenity=bank | 461 | |
| amenity=pharmacy | 424 | |
| shop=supermarket | 409 | |
| amenity=police | 158 | |
| amenity=marketplace | 143 | |
| place=neighbourhood | 96 | named localities |
| highway=bus_stop | 88 | |
| amenity=taxi (boda/taxi stages) | 82 | thin |
| place=suburb | 78 | |
| amenity=bus_station | 58 | |
| highway=* with a name | 4,148 ways | named roads; useful for "near X Road" matching |
| building=* | 1,567,904 ways | footprints (HOT/AI imports); a pin can be snapped to the nearest footprint |
| boundary=administrative, Uganda-wide | admin_level 4: 146 relations (districts incl. new ones); admin_level 9: 51 | parish/village boundaries mostly absent |
| amenity=hospital, clinic, fuel, shop=mall, place=village | not counted (mirrors overloaded) | re-run with the Geofabrik extract |

**Use:** landmark registry (points with names and categories), place nodes for area centroids where GeoNames has none,
admin boundaries where they exist (Uganda has few below district in OSM).
**Caveat:** ODbL share-alike. Keep OSM-derived rows in their own table with `source='osm'` and `osm_id`; see §12.

### 3.4 Electoral Commission polling stations (Kalulu repo, public data)
34,684 stations (2020 register). GKMA: Kampala 1,423 stations / 6 divisions / 98 parishes; Wakiso 1,434 / 27 / 147;
Mukono 619 / 18 / 97; Mpigi 245 / 9 / 56. Columns: district, constituency, sub-county, parish, station name, voters.
Station name examples: "MATHEL NURSERY SCHOOL (NAMUI-S)", "KAWEMPE MBOGO MUSLIM S.S.S. (A-K)", "JAMBULA [NABI-Z]- LC I
OFFICE", "UCTU GROUND (A-L)".
**Use:** (a) a complete **parish list per sub-county** for the four GKMA districts (398 parishes) to validate and extend
`ug_area`; (b) landmark **names** that locals know, to be matched against OSM/GeoNames points (strip the voter-range
suffixes `(A-K)`, `[NABI-Z]`; expand `P/S`→Primary School, `S.S.S`→Secondary School, `C/U`→Church of Uganda,
`R/C`→Roman Catholic). Unmatched names are kept as area-level landmarks (no point) and get a point the first time a
rider delivers there.

### 3.5 HDX COD-AB `cod-ab-uga` (CC BY-IGO)
GeoJSON 37 MB, SHP 33 MB, GDB 16 MB, XLSX 0.4 MB. Admin 4 = 1,520 sub-county polygons (2020).
**Use:** point-in-polygon to assign a sub-county to any pin or landmark; sanity-check that a GeoNames/OSM point lies in
the district `ug_area` says it does; derive district/sub-county centroids for the manual path. Not needed on the
request path; load into a `geo_admin_polygon` table (or keep as files) for batch jobs.

### 3.6 Delivered pins (own data, best source)
`addresses.gps_*`, `orders.delivery_location.gps*`, and the `delivery_quote_capture` row per order. Already designed
as the top of the centroid precedence in MODEL.md ("delivered pins, then manual, then band midpoint"). Today nothing
aggregates them. §6.5 adds the nightly job.

### 3.7 Google Plus Codes (Open Location Code)
Offline encode/decode, 14 m × 14 m at 10 characters (e.g. `6GCRPR6C+24` for central Kampala). npm:
`open-location-code` 1.0.3 (Google's) or `pluscodes` 3.0.1. **Use:** printed on the rider card and in the WhatsApp
message for every order with a pin; typed by a customer who has one. Never a required field.

### 3.8 Not used, and why
- KCCA street naming / house numbering: started 2017, GPS survey funded under KIIDP-2 (2024), no public dataset, no
  2025/26 status found. Revisit yearly.
- DataHub "postal-codes-ug": it is the GeoNames PPL list with empty postcode fields; use GeoNames directly.
- Public Nominatim for bulk: forbidden by its usage policy (1 req/s, no bulk). A self-hosted Nominatim/Photon on the
  Uganda extract is possible later; not needed for this spec.

---

## 4. Design principles (additions to the contract)

1. **Every location has an accuracy tier, and the quote knows it.** `PIN` (device GPS ≤50 m or pasted map link) →
   `LANDMARK` (a registry point) → `AREA_POINT` (area centroid) → `BAND_MIDPOINT` (today's behaviour) → `DISTRICT`
   (manual path). The tier is stored on the capture and shown to ops.
2. **A point never comes from nowhere.** Every `lat/lng` row carries `source`, `source_ref`, `confidence` (0–1) and
   `captured_at`. Contract #4 (no invented numbers) applies to coordinates.
3. **Open data first; paid APIs are optional enrichment behind a cache, with an off switch.** The checkout must work
   with Google and Mapbox both switched off (brief PART L).
4. **The customer chooses from things they know.** Area → landmark → optional pin. Typing directions stays possible
   but is the fallback, not the path.
5. **Measured kilometres replace band midpoints wherever a point exists; bands remain the fallback and the grouping.**
   The band of an area is recomputed from its measured road distance; the corridor stays as assigned.
6. **The rider gets everything the customer gave us, in one message:** area, landmark, directions, Plus Code, map link.

---

## 5. Architecture

```
checkout (web)                         api                                    data jobs (scripts, nightly/monthly)
──────────────                         ───                                    ──────────────────────────────────
UgandaLocationPicker  ──/locations/search──►  LocationSearchService (exists)
   └ landmark step    ──/locations/landmarks?area=──►  LandmarkSuggestUseCase (new)  ◄── ug_landmark (OSM+EC+own)
   └ pin / link / Plus Code  ──/locations/resolve-link (exists; + plus code)
                      ──/delivery/quote {areaSlug, point?, landmarkId?}──►  DeliveryQuotingUseCase (exists)
                                                           └ DeliveryAreaResolver.measuredKm (now filled from
                                                             geo_area_point / landmark / pin, road_km from geo_road_distance)
order ──► delivery_quote_capture (+ accuracy_tier, point, landmark_id)   ◄── nightly: pins → area points (§6.5)
rider card ──► landmark + directions + Plus Code + maps link
```

New tables (§6): `geo_area_point`, `geo_road_distance`, `geo_landmark_source` (OSM/EC/GeoNames raw), `ug_landmark`
extended, `geo_admin_polygon` (optional, batch only). New scripts: `geo-import-geonames.ts`, `geo-import-osm.ts`,
`geo-import-ec-stations.ts`, `geo-compute-road-distances.ts`, `geo-nightly-area-points.ts`. New use case:
`LandmarkSuggestUseCase`. Changes to existing code are small and listed in §9.

---

## 6. Database

Runs on Postgres 16 without PostGIS. Enable `cube` and `earthdistance` (both ship in `postgres:16-alpine`). Distances
in metres; `earth_distance(ll_to_earth(lat1,lng1), ll_to_earth(lat2,lng2))` is great-circle; a GiST index on
`ll_to_earth(lat,lng)` makes `earth_box` radius queries indexed. Upgrade path to PostGIS in §6.7.

### 6.1 `geo_area_point` — one best point per area
```sql
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

CREATE TABLE geo_area_point (
  area_slug        text PRIMARY KEY REFERENCES ug_area(area_slug),
  lat              double precision NOT NULL CHECK (lat BETWEEN -2.5 AND 5.5),
  lng              double precision NOT NULL CHECK (lng BETWEEN 28 AND 36.5),
  source           text NOT NULL CHECK (source IN ('delivered_pins','manual','osm_place','geonames','admin_polygon')),
  source_ref       text,                      -- geonames id, osm type/id, admin pcode, or 'pins:<n>'
  confidence       numeric(3,2) NOT NULL,     -- 0.95 pins(n>=5), 0.90 manual, 0.70 osm_place, 0.60 geonames, 0.40 admin_polygon
  sample_size      integer NOT NULL DEFAULT 0, -- delivered pins used
  spread_m         integer,                   -- p90 distance of pins from the median, when source=delivered_pins
  set_by           text,                      -- 'job:geo-nightly' | admin user id
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX geo_area_point_earth_idx ON geo_area_point USING gist (ll_to_earth(lat, lng));
```
Precedence when writing (highest wins, never downgrade automatically): `delivered_pins` (≥5 pins, p90 spread ≤ 1,500 m)
> `manual` > `osm_place` > `geonames` > `admin_polygon`. The nightly job may replace `geonames`/`osm_place` with
`delivered_pins`; it never overwrites `manual`.

### 6.2 `geo_road_distance` — road distance from an origin to a point, computed once
```sql
CREATE TABLE geo_road_distance (
  origin_code      text NOT NULL REFERENCES delivery_origin(origin_code),
  target_kind      text NOT NULL CHECK (target_kind IN ('area','landmark','pin_cell')),
  target_key       text NOT NULL,             -- area_slug | landmark id | geohash-7 cell of a pin
  straight_km      numeric(6,2) NOT NULL,
  road_km          numeric(6,2),              -- null until routed
  road_minutes_freeflow numeric(6,1),
  router           text,                      -- 'osrm-offline:<date>' | 'google-routes' | 'mapbox-directions' | 'factor:<detour>'
  computed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (origin_code, target_kind, target_key)
);
```
`pin_cell` rows cache routing for pins by 7-character geohash (~150 m cells) so a repeat pin never re-routes.
When `road_km` is null the model uses `straight_km × detour factor` (the learned `detour` factor already in
`delivery_learned_factor`), and records `router='factor:…'`.

### 6.3 `ug_landmark` — extended into the registry
```sql
ALTER TABLE ug_landmark
  ADD COLUMN source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','osm','geonames','ec_station','order_pin','rider')),
  ADD COLUMN source_ref    text,              -- 'node/123', geonames id, 'ec:12-062-01-06-24'
  ADD COLUMN category      text,              -- school|church|mosque|hospital|clinic|pharmacy|bank|market|mall|supermarket|fuel|police|stage|bus_stop|office|other
  ADD COLUMN confidence    numeric(3,2) NOT NULL DEFAULT 0.5,
  ADD COLUMN aliases       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN normalised    text,              -- folded name for search (packages/shared folding)
  ADD COLUMN active        boolean NOT NULL DEFAULT true,
  ADD COLUMN last_seen_at  timestamptz,       -- last time the source still had it
  ADD COLUMN sub_county    text,              -- from admin polygon or ug_area
  ADD COLUMN parish        text;
-- gps_lat/gps_lng already exist (double precision, nullable). Points are mandatory for source in ('osm','geonames','order_pin','rider').
CREATE INDEX ug_landmark_earth_idx ON ug_landmark USING gist (ll_to_earth(gps_lat, gps_lng)) WHERE gps_lat IS NOT NULL;
CREATE INDEX ug_landmark_norm_trgm ON ug_landmark USING gin (normalised gin_trgm_ops);
CREATE UNIQUE INDEX ug_landmark_source_ref_uq ON ug_landmark (source, source_ref) WHERE source_ref IS NOT NULL;
```
`area_slug` is set by point-in-polygon against sub-county (HDX) + nearest `geo_area_point` within that sub-county; when
ambiguous, nearest area point within 1,500 m; otherwise null (`active=false` until an admin places it).

### 6.4 Capture and order additions
```sql
ALTER TABLE delivery_quote_capture
  ADD COLUMN accuracy_tier  text CHECK (accuracy_tier IN ('PIN','LANDMARK','AREA_POINT','BAND_MIDPOINT','DISTRICT')),
  ADD COLUMN point_lat      double precision,
  ADD COLUMN point_lng      double precision,
  ADD COLUMN landmark_id    uuid REFERENCES ug_landmark(id),
  ADD COLUMN road_km        numeric(6,2),
  ADD COLUMN plus_code      text;
-- orders.delivery_location (jsonb) gains: landmarkId, landmarkName, plusCode, accuracyTier (validated in routes/commerce.ts zod).
```
`had_pin` (exists) becomes derived: `accuracy_tier = 'PIN'`.

### 6.5 Nightly job `geo-nightly-area-points.ts`
For each `area_slug` with ≥5 delivered orders whose `first_attempt_success = true` and a pin with `gps_accuracy_m ≤ 100`
in the last 365 days: take the geometric median of the pins; `spread_m` = p90 distance from it. If `spread_m ≤ 1,500`
write/replace `geo_area_point` with `source='delivered_pins'`; else leave the existing row and log the spread (an
area that wide is probably two areas, or an alias covering several; surface in `/admin/locations`).
Also: for every `ug_landmark` with `source='ec_station'` and no point, if ≥3 delivered pins reference it
(`landmark_id`), set its point the same way (`source` stays `ec_station`, `confidence` 0.8).

### 6.6 Queries the request path uses
Nearest landmarks to an area point (checkout suggestion list):
```sql
SELECT l.id, l.name, l.category, l.confidence,
       earth_distance(ll_to_earth(l.gps_lat, l.gps_lng), ll_to_earth($lat, $lng)) AS metres
FROM ug_landmark l
WHERE l.active AND l.gps_lat IS NOT NULL
  AND earth_box(ll_to_earth($lat, $lng), 2500) @> ll_to_earth(l.gps_lat, l.gps_lng)
ORDER BY (l.area_slug = $area_slug) DESC, l.usage_count DESC, metres
LIMIT 12;
```
Area for a pin (manual path with GPS): nearest `geo_area_point` within 3 km in the chosen district, else the
sub-county polygon's district centroid → `AREA_TOO_COARSE` as today.

### 6.7 PostGIS upgrade path (optional, later)
When polygons or true KNN are needed on the request path: switch the compose image to `postgis/postgis:16-3.4-alpine`,
`CREATE EXTENSION postgis`, add `geography(Point,4326)` columns generated from lat/lng, replace `earth_box` with
`ST_DWithin` and ordering with `<->`. Nothing in the API contract changes. Do not do this in Phase A: the 4 GB host
and the rehearse-then-migrate deploy script are fine with contrib extensions, and the data volume (≤100k points) does
not need an R-tree yet.

---

## 7. Ingestion pipelines (scripts under `apps/api/src/scripts/`, idempotent, MD5-gated like the existing importers)

### 7.1 `geo-import-geonames.ts`
Input `UG.txt` (tab-separated, 19 columns: geonameid, name, asciiname, alternatenames, lat, lng, class, code, …,
admin1, admin2, …). Load PPL/PPLX/PPLL/ADM4/ADM5/SCH/HSP/HSPC/CH/MSQE/MKT. Match to `ug_area` by folded name within
`current_district` (admin2 name → district; GeoNames admin1 C/E/N/W = Central/Eastern/Northern/Western). On a unique
match write `geo_area_point` (source `geonames`, confidence 0.60) unless a higher-precedence row exists. Report:
matched / ambiguous (same name twice in a district: pick the ADM5 over PPL, else leave for manual) / unmatched.
Expected for the 362 metro areas: ≥250 matched on the first run (118 ADM5 + 1,205 PPL in the box).

### 7.2 `geo-import-osm.ts`
Preferred input: `uganda-latest.osm.pbf` filtered offline with `osmium tags-filter` to the tags below, exported as
GeoJSON (`osmium export`), so the job needs no network and no Overpass rate limits. Fallback: Overpass QL per tag with
`out center;` (Appendix A), one request per 10 s, mirrors in order, bbox = GKMA box.
Tags → categories: `amenity=school`→school; `place_of_worship` + `religion`→church|mosque; `hospital`→hospital;
`clinic|doctors`→clinic; `pharmacy`; `bank|atm`→bank; `marketplace`→market; `shop=mall`→mall; `shop=supermarket`;
`amenity=fuel`→fuel; `police`; `amenity=taxi`→stage; `highway=bus_stop|amenity=bus_station`→bus_stop;
`place=suburb|neighbourhood|village|hamlet|locality`→ area candidates (not landmarks).
Write `ug_landmark` rows with `source='osm'`, `source_ref='node/<id>'|'way/<id>'|'relation/<id>'`, `confidence` 0.70
(0.80 if `name` and `addr:*` present), `last_seen_at=now()`. Objects without a `name` are skipped except stages
(`stage` rows take the nearest named road/place as a generated name: "Boda stage, Kira Road / Bukoto"). Place nodes
without a `geo_area_point` match become `osm_place` area points (confidence 0.70).
A row not seen in two consecutive imports gets `active=false` (never deleted: order history references it).

### 7.3 `geo-import-ec-stations.ts`
Input `voter_register_summary_2020.csv`, districts limited to the GKMA four in Phase B (national in Phase C).
Steps: (1) upsert the parish list into `ug_area` as **candidate areas** (`selectable=false`, `data_version='ec2020'`)
when a parish is missing from the ICT list; the admin promotes them from `/admin/locations` (an existing alias/area
promotion flow). (2) Normalise station names (strip `(A-K)`, `[NAM-Z]`, trailing codes; expand abbreviations;
title-case) and dedupe (one station name often appears 2–4 times split by voter range). (3) Match each name to an
`ug_landmark` with a point, in the same district, by folded trigram ≥ 0.6 **and** same category word (school↔school);
on a match add the EC name to `aliases` and raise `confidence` by 0.1. (4) Unmatched names become `ug_landmark` rows
with `source='ec_station'`, no point, `area_slug` = the parish's area, `active=true` (they can be chosen; the quote
then uses the area point, tier `AREA_POINT`, and §6.5 gives them a point over time).

### 7.4 `geo-compute-road-distances.ts`
For each `geo_area_point` and each active landmark point in the metro set, compute `straight_km` (haversine) and
`road_km`. Router options, in preference order:
1. **OSRM offline on the Mac** (free, no runtime dependency): `osrm-extract` + `osrm-contract` on
   `uganda-latest.osm.pbf` (car profile; ~2–4 GB RAM during build, minutes to run), then `osrm-routed` locally and a
   `/table` call from the one origin to all points. Store `router='osrm-offline:<pbf date>'`. Re-run quarterly.
2. **Google Routes `computeRouteMatrix`** (Essentials: 10,000 free elements/month, then $5.00/1,000): 1 origin × ≤1,000
   targets = ≤1,000 elements, well inside the free tier. Store `router='google-routes'`.
3. Mapbox Matrix (100,000 free elements/month).
Output also recomputes `delivery_corridor.distance_band` from `road_km` with the MODEL.md band edges and writes a
dry-run CSV for the Control Centre's corridor round-trip (existing import path) rather than updating bands silently.

### 7.5 Scheduling
GeoNames and OSM: monthly (`systemd` timer on the host like the Lighthouse watch, or run from the Mac and import
the CSV). EC: once per election register (next after the 2026 register is published). Nightly: §6.5. All scripts print
a report and refuse to apply if the matched count drops by >10% from the previous run (data-regression guard).

---

## 8. Checkout experience

Keeps `UgandaLocationPicker` and adds one step. Mobile-first; works offline for the area step (existing index).

1. **Area** (exists): search or browse; result shows "Ntinda, Kampala · Nakawa Division".
2. **Landmark** (new): "Nearest place everyone knows" — a list from `/locations/landmarks?area=<slug>` (up to 12:
   area's own landmarks by `usage_count`, then nearest within 2.5 km), grouped by category with icons (school, church,
   mosque, stage, mall, petrol, bank, clinic, police). Type-ahead over `normalised` (trigram). Choosing one sets
   `landmarkId`; "None of these" keeps the free-text field, which is renamed **"Directions for the rider"**
   (gate colour, floor, "after the mosque, blue gate"). The directions field is required only when no landmark and no
   pin is given.
3. **Pin** (exists, improved): "Share my location" (GPS; shows accuracy, accepted ≤100 m) or paste a Google Maps /
   WhatsApp link. New: a Plus Code field (validated offline with `open-location-code`; a short code is expanded with
   the area point as the reference). When a pin is present, the suggested landmark list re-sorts by distance to the pin.
4. **Quote** (exists): `/delivery/quote` is called with `{areaSlug, landmarkId?, point?}`; the response includes
   `accuracyTier` and the copy already defined in the registry (`copy_*`). Wording for the customer by tier (registry
   keys, editable without deploy): PIN/LANDMARK → the fixed quote; AREA_POINT → fixed quote; BAND_MIDPOINT →
   "estimate; confirmed when we call"; DISTRICT → "Confirmed by phone before dispatch" (unchanged).
5. **Order payload**: `deliveryLocation` gains `landmarkId`, `landmarkName`, `plusCode`, `accuracyTier`;
   `deliveryAddress` keeps the directions text. The post-checkout "save address" sends `areaSlug`, `landmarkText`,
   `gps*` (today it drops them).
6. **Pickup** (exists): when the customer picks collection, store `pickup_point_id` on the order (today it is text only).

Failure paths: landmark service down → step 2 is skipped silently (the area path is unchanged); pin refused (accuracy
>100 m) → "We couldn't get a precise location; choose a landmark instead"; no network → area step from the offline
index, landmark step skipped, directions required.

Copy rules follow `docs/customer-language-standard.md`: "boda stage" not "taxi rank"; "landmark"; never "GPS
coordinates" in customer copy.

---

## 9. Changes to existing code (small, listed so nothing is lost)

| File | Change |
|---|---|
| `infrastructure/delivery/DeliveryAreaResolver.ts` | fill `measuredKm` from (pin → `geo_road_distance` pin_cell or haversine×detour) → (landmark point) → (`geo_area_point`) → null; return `accuracyTier` and the point used |
| `domain/delivery/DeliveryModel.ts` | when `measuredKm` is present use it for `round_trip_km = measured_road_km × 2` instead of `band_midpoint × 2 × detour`; keep the band for factors and reporting |
| `application/use-cases/delivery/DeliveryQuotingUseCase.ts` | accept `landmarkId`, `point`; pass `hasPin`; honour `delivery_corridor.fulfilment_mode` (today `declaredMode: null`, a known gap) |
| `interfaces/http/routes/delivery.ts`, `routes/commerce.ts` | zod: `landmarkId` uuid, `point {lat,lng,accuracyM,source}`, `plusCode` ^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}$ ; include `accuracyTier` in the response; cache key includes landmark/pin cell |
| `routes/locations.ts` | `GET /landmarks?area=&q=&near=lat,lng` → `LandmarkSuggestUseCase`; `POST /resolve-link` also decodes Plus Codes |
| `CheckoutUseCase.ts` | write `accuracy_tier`, `point_*`, `landmark_id`, `road_km`, `plus_code` to the capture; bump `ug_landmark.usage_count` on order placed |
| `checkout.astro`, `lib/checkout.ts`, `locationPickerClient.ts` | landmark step, Plus Code field, payload fields, saved-address fields |
| `admin/orders/[id].astro` rider card | add landmark name, Plus Code, `https://maps.google.com/?q=<lat>,<lng>` link, accuracy tier badge |
| `admin/locations.astro` | landmark registry tab: search, verify, merge (exists), set point by pasting a link, "wide-spread areas" list from §6.5 |
| `scripts/generate-locations-index.ts` | include `lat/lng` per metro area in the offline index when available (for pin→area offline) |
| `DeliveryConfigRegistry.ts` | new keys: `pin_max_accuracy_m` (100), `landmark_suggest_radius_m` (2,500), `area_point_min_pins` (5), `area_point_max_spread_m` (1,500), `enrichment_provider` (none|google|mapbox), copy per tier |
| `docs/delivery/MODEL.md` §3 | one paragraph: centroid precedence now has a concrete source table (`geo_area_point`) and road km |

Nothing is deleted. The legacy `delivery_zones` fallback stays until PROGRESS.md §7's hard stop is lifted.

---

## 10. Switching the model on: the six numbers (this is the biggest fee-accuracy win and needs no code)

All of §5–§9 improves *where* a customer is. Fees stay "confirmed by phone" until the launch wizard
(`/admin/delivery/launch`) has its answers. Per contract #4 this spec does not invent them; Rob provides them from the
riders' actual pay and the shop's costs:

| Wizard answer | Config key | What it means |
|---|---|---|
| A place riders go often, and the round-trip minutes | calibrates `speed`/`detour` prior | e.g. Ntinda, 50 minutes door to door and back |
| Rider pay per hour (or per trip) | `rider_cost_per_minute` | UGX |
| Handling minutes per order | `handling_minutes` | picking, packing, handover |
| Margin multiplier | `margin` | 1.0 = at cost |
| Minimum fee | `minimum_fee_ugx` | the floor |
| Furthest place a rider still goes | `own_rider_max_band` | everything beyond → bus parcel / pickup |
| Free-delivery threshold (optional) | `free_delivery_threshold_ugx` | the waiver basis is already built |

With these set and §6/§7 in place, the quote for Ntinda is `max(min_fee, cost_per_minute × (handling + road_km×2 /
speed × 60 × factors + last_mile) × margin)` with road_km measured, rounded to `fee_rounding_step_ugx` (500).

---

## 11. Maps and geocoding providers: costs and the decision

Volume assumption for sizing: 1,000 checkouts/month, 3 quote calls per checkout, 1 map load per checkout, 300 pins.
Prices are list prices on 2026-10-15 from the providers' own pricing pages.

### 11.1 Google Maps Platform (per 1,000, after the monthly free amount; Essentials tier unless stated)
| SKU | Free/month | Then |
|---|---|---|
| Autocomplete Requests | 10,000 | $2.83 (session-based billing available: Autocomplete Session Usage is free; the Place Details call at the end is billed) |
| Place Details (Essentials / Pro / Enterprise) | 10,000 / 5,000 / 1,000 | $5.00 / $17.00 / $20.00 |
| Geocoding | 10,000 | $5.00 |
| Address Validation (Pro) | 5,000 | $17.00 |
| Dynamic Maps (Maps JavaScript) | 10,000 | $7.00 |
| Static Maps | 10,000 | $2.00 |
| Compute Routes (Essentials / Pro / Enterprise) | 10,000 / 5,000 / 1,000 | $5.00 / $10.00 / $15.00 |
| Compute Route Matrix (per element) | 10,000 | $5.00 |
| Distance Matrix (legacy) | 10,000 | $5.00 |
At the sizing volume every SKU stays inside the free amount. Google Places has the best coverage of Kampala
businesses and landmarks of any provider; it is the right **enrichment** source for landmark type-ahead if we want one.

### 11.2 Mapbox (per 1,000)
| API | Free/month | Then |
|---|---|---|
| Geocoding (temporary) | 100,000 | $0.75 (100k–500k) |
| Geocoding (permanent, allowed to store) | none | $5.00 |
| Search Box API (session, standard) | 2,500 | $11.50 |
| Directions | 100,000 | $2.00 |
| Matrix (per element) | 100,000 | $2.00 |
| Map loads (GL JS) | 50,000 | $5.00 |
| Static Images | 50,000 | $1.00 |
Mapbox's Uganda place data is thinner than Google's for named landmarks; its strengths are tiles and routing. Note
the licensing trap: **temporary** geocoding results may not be stored; storing requires the permanent SKU ($5/1,000).

### 11.3 Free / self-hosted
| Need | Option | Cost | Note |
|---|---|---|---|
| Map tiles for the pin step | **MapLibre GL + Protomaps PMTiles** of Uganda, served as one static file from the web container or Cloudflare R2 | $0 | ~100–300 MB file; no API key; OSM attribution required |
| Map tiles (zero effort) | Leaflet + OSM tile servers | $0 | OSMF tile usage policy forbids heavy/commercial use; acceptable only for admin screens |
| Geocoding | self-hosted Photon or Nominatim on the Uganda extract | host RAM (Nominatim needs ~2 GB for Uganda) | not needed: our registry is the geocoder |
| Routing | OSRM run offline on the Mac (§7.4) | $0 | no runtime service |

### 11.4 Decision
- **Primary (Phase A–C): no paid API on the request path.** Area and landmark lookups come from our own tables; pins
  come from the device or pasted links; distances are precomputed (OSRM offline) or haversine×detour.
- **Map for the pin step:** MapLibre + self-hosted PMTiles (Uganda extract). If that is more build than wanted for Phase
  B, Google Dynamic Maps within the 10,000 free loads is acceptable, behind `enrichment_provider='google'`, with the
  pin step hidden when the key is absent.
- **Enrichment (optional, Phase D):** Google Places Autocomplete (session) + Place Details Essentials for landmark
  type-ahead when our registry returns fewer than 3 results. Google's terms forbid storing Places data for more than
  30 days (place IDs excepted), so results are never written into `ug_landmark`; only the `place_id` may be kept and
  the place re-fetched. This is why the registry, not a provider, is the system of record.
- **Mapbox:** not chosen. Its advantages (cheap tiles/routing at scale) do not apply at our volume, and its landmark
  coverage in Kampala is weaker.

---

## 12. Licensing and privacy

- **OSM (ODbL):** keep OSM-derived rows identifiable (`source='osm'`, `osm_id`) and in their own logical set; show
  "© OpenStreetMap contributors" wherever OSM-derived landmarks or tiles are displayed. Because the public site uses a
  database that mixes OSM with other sources, treat the OSM-derived landmark table as a *derivative database* and be
  prepared to publish that table (not orders, not customers) on request. Keeping our own landmarks/pins in rows with
  `source` ≠ 'osm' makes the whole a *collective database*, which is the safe shape.
- **GeoNames:** CC BY 4.0 — attribution in `/privacy` data-sources note and the admin page.
- **HDX COD-AB:** CC BY-IGO — attribution; batch use only.
- **EC data:** public records, no licence stated in the repo; names of public institutions. Keep voter counts out of
  our database (we only need names and hierarchy).
- **Customer pins (DPPA 2019):** a pin is personal data. Keep the brief's PART K: store with the order, use for
  delivery and for the aggregate area point, and delete raw pins after the retention period Rob decides (recommended
  180 days; the aggregate `geo_area_point` keeps no per-customer data). The nightly job must only read pins inside the
  window.

---

## 13. Rollout

**Phase A — measure, don't guess (1–2 weeks, no customer-visible change).** Enable `cube`/`earthdistance`; create
`geo_area_point`, `geo_road_distance`; run GeoNames + OSM place import for the 362 metro areas; run OSRM offline for
road km; wire `measuredKm`; recompute bands as a dry-run CSV for Rob to review in the Control Centre; set the six
numbers in the launch wizard; publish. **Done when:** ≥90% of the 362 metro areas have a point with confidence ≥0.6,
every one has `road_km`, and a quote for 10 named test areas (Ntinda, Kabalagala, Najjera, Kajjansi, Kyengera, Kira,
Bweyogerere, Nansana, Munyonyo, Mukono town) returns a fee from the model, not "confirmed by phone".

**Phase B — landmarks at checkout (2–3 weeks).** OSM landmark import (schools, churches/mosques, malls, supermarkets,
petrol, banks, police, clinics, stages); `ug_landmark` extension; `GET /locations/landmarks`; the landmark step; Plus
Code field; capture `accuracy_tier`; rider card additions; admin registry tab. **Done when:** 60% of metro orders carry a
landmark or a pin within two weeks of release, and `delivery_quote_capture.accuracy_tier` is never null.

**Phase C — polling-station names and the national list (1–2 weeks).** EC import for GKMA, then national; parish
candidates into `ug_area`; alias enrichment. **Done when:** every GKMA parish in the EC list exists in `ug_area` or is
mapped to one, and ≥50% of EC names in GKMA have a point.

**Phase D — learn from deliveries (ongoing).** Nightly area points from pins; quarterly OSRM refresh; calibration
proposals (exists) now driven by measured km; optional Google enrichment behind the switch; PostGIS only if a trigger in
OPERATIONS.md PART 7 fires.

Each phase ships behind the existing Control Centre: config keys are drafts until published, and everything reverts in
one action (contract #9).

---

## 14. Open decisions for Rob

1. The six launch numbers (§10). Nothing quotes without them.
2. Pin retention period (recommended 180 days).
3. Should the landmark step be mandatory for door delivery inside Kampala/Wakiso when no pin is given? (Recommended:
   yes for new customers, optional for customers with a delivered address on file.)
4. Map for the pin step: self-hosted PMTiles (more build, no key, no bill) or Google Dynamic Maps (fast, key, free at
   our volume)?
5. Same-day eligibility: by band (B0–B3 before the cutoff) rather than the hardcoded Kampala/Wakiso list in
   `checkout.astro`. Recommended: by band, via the registry.
6. Whether to publish the OSM-derived landmark table openly (simplest ODbL compliance).

---

## Appendix A — Overpass QL (one tag per request; `out center;` gives a point for ways/relations)

```
[out:json][timeout:180];
(
  node["amenity"="school"](-0.05,32.30,0.60,32.95);
  way["amenity"="school"](-0.05,32.30,0.60,32.95);
  relation["amenity"="school"](-0.05,32.30,0.60,32.95);
);
out center tags;
```
Whole country by ISO code (slower; prefer the Geofabrik extract):
```
[out:json][timeout:600];
area["ISO3166-1"="UG"][admin_level=2]->.ug;
(
  node["amenity"~"^(school|hospital|clinic|place_of_worship|taxi|fuel|bank|marketplace|police|pharmacy)$"](area.ug);
  way["amenity"~"^(school|hospital|clinic|place_of_worship|taxi|fuel|bank|marketplace|police|pharmacy)$"](area.ug);
  relation["amenity"~"^(school|hospital|clinic|place_of_worship|taxi|fuel|bank|marketplace|police|pharmacy)$"](area.ug);
);
out center tags;
```
Place nodes for area centroids: replace the tag filter with `["place"~"^(suburb|neighbourhood|village|hamlet|locality)$"]`.
Etiquette: identify with a `User-Agent`, one request at a time, ≥10 s between requests, retry across mirrors
(`overpass.kumi.systems`, `overpass.private.coffee`, `maps.mail.ru/osm/tools/overpass`, `overpass-api.de`).

Offline alternative (no limits):
```
osmium tags-filter uganda-latest.osm.pbf nwr/amenity=school,hospital,clinic,place_of_worship,taxi,fuel,bank,marketplace,police,pharmacy nwr/shop=mall,supermarket nwr/place=suburb,neighbourhood,village,hamlet,locality -o gkma-pois.osm.pbf
osmium export gkma-pois.osm.pbf -f geojsonseq -o gkma-pois.geojsonl   # one feature per line; ways/relations as polygons → take centroid in the importer
```

## Appendix B — GeoNames `UG.txt` columns used
`geonameid(1) name(2) asciiname(3) alternatenames(4) latitude(5) longitude(6) feature_class(7) feature_code(8)
country(9) admin1(11) admin2(12) population(15) modification_date(19)`. Feature codes: PPL populated place, PPLX
section of populated place, ADM4/ADM5 admin divisions (sub-county/parish level in Uganda), SCH school, HSP hospital,
HSPC clinic, CH church, MSQE mosque, MKT market.

## Appendix C — EC station name normalisation (examples)
| Raw | Normalised | Category |
|---|---|---|
| `MATHEL NURSERY SCHOOL (NAMUI-S)` | Mathel Nursery School | school |
| `KAWEMPE MBOGO MUSLIM S.S.S. (A-K)` | Kawempe Mbogo Muslim Secondary School | school |
| `KISIMBIRI B [NAT -Z] KISIMBIRI C/U P/S` | Kisimbiri Church of Uganda Primary School | school |
| `JAMBULA [NABI-Z]- LC I OFFICE` | Jambula LC1 Office | office |
| `UCTU GROUND (A-L)` | UCTU Ground | other |
Rules: remove `\(.*?\)` and `\[.*?\]` voter ranges; expand `P/S`, `P.S`, `S.S.S`, `S.S`, `C/U`, `R/C`, `S.D.A`,
`H/C` (health centre), `T/C` (trading centre), `LC I` → `LC1`; collapse spaces; title-case except acronyms.

## Appendix D — accuracy tier and what the rider gets
| Tier | Customer gave | Rider card shows | Distance used |
|---|---|---|---|
| PIN | device GPS ≤100 m or pasted link | map link, Plus Code, landmark if any, directions | road km to pin cell (cached) or haversine×detour |
| LANDMARK | a registry landmark | landmark name + category, map link to it, directions | road km to landmark |
| AREA_POINT | area only | area, directions, "call before dispatch" if no directions | road km to area point |
| BAND_MIDPOINT | area without a point yet | as today | band midpoint |
| DISTRICT | manual path | as today | none; manual queue |

## Appendix E — sources
- Research note: "Strategic Geospatial Architecture and Last-Mile Logistics Optimization for E-Commerce Delivery in Uganda" (owner-supplied, 2026).
- HDX `cod-ab-uga` metadata (CKAN API, 2026-09-24 resources); GeoNames `UG.zip` (2026-10-15 download); Kalulu repo file list and `voter_register_summary_2020.csv` (fetched 2026-10-15); Overpass counts (2026-10-15, mirrors as noted).
- Google Maps Platform pricing page (page dated 2026-10-14); Mapbox pricing page (2026-10-15).
- Nominatim usage policy (1 req/s, no bulk, caching required).
- KCCA road naming and house numbering guidelines (2017); The Independent on the KIIDP-2 addressing survey (2024).
