# Kampala Metropolitan Address System — specification

Version 2.2, 2026-10-15 (2.1 added §0b, §4.4–4.6, §15 and Week 0; 2.2 is a consistency pass against the code,
Appendix I items 24–30; nothing from 2.0 is removed). Research and design for making delivery locations, and therefore delivery fees, more
accurate on shopgoldplus.com. Written for a coding assistant or engineer to build from. Version 1 (same day, five
commits on PR #115) was a catalogue of data sources with a design attached; version 2 is the design, with the
catalogue moved to the appendices and the drafting history to Appendix I. Every measured number from version 1 is
kept. District count used throughout: **146 districts and cities** (Electoral Commission, 2025), counted together.

**Read these first and keep them in context:** `docs/delivery/CONTRACT.md` (ten guarantees; nothing below breaks
them, and three are cited by number: #4 no invented numbers, #5 a quote at checkout is fixed, #8 a data gap never
blocks a sale), `docs/location-module-brief.md` (PART L: never make a paid geocoder a dependency; never invent fees or
centroids), `docs/delivery/MODEL.md` (the minutes model this feeds; §3.3 the six launch numbers).

**What this spec is:** the coordinate, pin, landmark and distance layer that the existing module was designed to
receive ("OSM centroids" is already a Phase 2 item in `docs/delivery/OPERATIONS.md` PART 7). **What it is not:** a
rewrite of the gazetteer, the quoting service, the Control Centre, the checkout picker or the corridor data. All of
those are kept and extended.

---

## 0. The design in one page

**Why quotes are wrong today, ranked by how much fee error each one causes:**

1. **The six launch numbers are unset** (`own_rider_max_band` and the five mandatory values), so every quote is
   `CONFIG_INCOMPLETE` and the customer reads "Confirmed by phone before dispatch". No geography fixes this; only the
   owner can (§11). Everything else in this document is wasted until it is done.
2. **No area has a coordinate**, so every distance is a band midpoint. Bands are 2–25 km wide (Appendix F): two areas
   in B4 are priced the same whether they are 15 or 25 km out, a difference of 20 km per round trip. Worse for
   calibration: while distance is unknown, the learned `detour`, `corridor` and `hour` factors absorb distance error,
   so the model cannot learn the things it was built to learn. Points first, then calibration.
3. **Pins never reach the order.** Checkout never sends `hasPin`; WhatsApp location pins are already received and
   parsed but dropped into chat text; riders record nothing at handover. Three pin channels exist in production and
   none of them writes a coordinate anywhere useful.
4. **The landmark is free text**, so it cannot be matched to a point, reused, or ranked.

**The success metrics: three that exist, one to start counting.** `delivery_quote_capture` already stores
`expected_minutes`, `actual_minutes`, `quoted_fee_ugx`, `final_fee_ugx`, `actual_rider_cost_ugx` and
`first_attempt_success` per order. (1) The 28-day median of |expected − actual| minutes should fall. (2) The share of
metro orders quoted by the model (not "confirmed by phone") should rise. (3) **First-attempt success should rise**: a
failed attempt is a whole second trip, the largest hidden delivery cost in Kampala, and it is what better locations
fix first. All three are computable today and form the baseline before any change ships. (4) Not measured today: how
many customers leave at the fee step. The quote endpoint runs before an order exists, so one counter (quotes shown
per session vs orders placed) makes fee shock visible; add it in Phase A. Targets are the owner's to set (contract
#4), proposed in §12.

**The order of work (critical path, nothing else is on it):**

| Step | What | Who | Code |
|---|---|---|---|
| 0 | Set the six launch numbers in `/admin/delivery/launch` | owner | none |
| 1 | A point for each of the 362 metro areas from the UBOS 2016 parish polygons (building-weighted, §3), validated against the existing bands (§3.4); straight-line km wired into `measuredKm` behind a Control-Centre switch (§4) | engineer, ~1 week | one script, one table, one resolver change |
| 2 | Route the pins that already exist to the order: WhatsApp location messages, a one-tap rider handover link, pasted map links, saved addresses that remember their pin (§5) | engineer, ~1 week | three small use cases |
| 3 | Landmarks: mined from the shop's own order text first, OSM second, EC station names third; a landmark step at checkout (§6) | engineer, ~2 weeks | registry extension, one endpoint, one checkout step |
| 4 | The learning loop: delivered pins become area points nightly; road km from OSRM replaces straight-line × detour where present (§4.2, §3.5) | ongoing | one nightly job |

**The one product decision the owner must make before Step 1 ships (§12, decision 1):** what the customer sees when
distance becomes measured: a fee *per area* (continuous, as MODEL.md computes it), the *same bands with the wrong
areas moved* (re-banding), or a short **price ladder the owner prices and the model places areas on** (§4.5). The
data is the same for all three; the switches are registry keys; the recommendation is re-banding onto a ladder first.

## 0b. What stays exactly as it is, and the rule for everything new

Nothing in this document replaces anything that works. Kept unchanged: the contract and its one quoting service; the
minutes model and its equation; `ug_area` and its slugs; `delivery_corridor` with its 14 corridors and bands (they
become the prior and the fallback, never deleted); the Control Centre, the launch wizard, the calibration proposals
and the versioned config; the checkout picker; the capture table; every migration to 0188. The rule for everything
new: **additive, behind a switch, reversible in one action, with a dry run before publish** (contracts #7 and #9). A
reader who deletes every section after §1 is left with the working shop they have; a reader who applies them in order
is left with a more accurate one.

---

## 1. What exists today (verified in the code on 2026-10-15)

| Layer | What is there | Where |
|---|---|---|
| Gazetteer | `ug_area` 5,805 areas / 135 districts (Ministry of ICT draft postcodes, April 2019), `ug_area_alias` 28, groups, exceptions 255, trigram search, offline index (390 metro entries) | `apps/api/src/infrastructure/db/schema/locations.ts`, migration 0084, `scripts/import-locations.ts` |
| Metro delivery set | `delivery_corridor` 362 areas: 14 corridors, bands B0–B6, access road/water, `centroid_lat/lng` columns **never written** | migrations 0092–0096, `scripts/import-delivery.ts` |
| Origin | `delivery_origin` HUB `GoldPlus Zainab Aziza`, 0.314220, 32.577920 (±10 m) | migrations 0168, 0173 |
| Fee model | `expected_minutes = handling + travel + last_mile`; `travel = round_trip_km / speed × 60 × corridor × hour`; `round_trip_km = band_midpoint × 2 × detour`, or **real straight-line distance × detour where a measured centroid exists** (MODEL.md §3); fee = `max(min_fee, cost_per_minute × minutes × margin)`; window from percentiles | `domain/delivery/DeliveryModel.ts`, `DeliveryQuoteService.ts` |
| Quoting entry points | `POST /delivery/quote`, `GET /commerce/delivery-estimate`, `CheckoutUseCase` | `interfaces/http/routes/delivery.ts`, `routes/commerce.ts` |
| Config | versioned `delivery_config_value`, learned factors (`origin='prior'` until fitted), calibration proposals, Control Centre + launch wizard | `admin/delivery/*.astro`, `DeliveryConfigRegistry.ts` |
| Capture per order | `delivery_quote_capture`: area, alias, corridor, band, quoted/final fee, `actual_rider_cost_ugx`, `expected_minutes`, `actual_minutes`, `dispatched_at`, `delivered_at`, `had_pin` (never set), `first_attempt_success`, `distance_travelled`, **`straight_line_km`**, **`centroid_source`**, `eat_hour_of_week`, config version | `schema/delivery.ts` 148–187 |
| Addresses | `addresses` widened with `area_slug`, `landmark_text`, `gps_lat/lng/accuracy/source`, `resolution_status`, `pickup_point_id`, `snapshot_*` labels | migration 0084 |
| Landmarks | `ug_landmark` (area_slug, name, type, usage_count, verified, gps) — **admin-written only, 0 rows from checkout** | `DrizzleLocationAdminRepository.ts` |
| Search misses | `ug_search_miss`: raw and normalised query, result count, what it was eventually resolved to and via what (alias/group/landmark/manual) | `schema/locations.ts` 176 |
| Pickup points | `ug_pickup_point` with GPS, hours, carrier — **no rows seeded** | migration 0084, 0093 |
| Bus / upcountry | 128 towns on 9 routes; `delivery_bus_rate_card` — **0 cards, no write path** | `scripts/import-bus-destinations.ts` |
| Fulfilment | `fulfilment_dispatches` (method, `rider_name` free text, no rider account), `fulfilment_deliveries` (attempt, outcome, `delivered_at`, recipient confirmation, proof reference) — **no coordinate recorded at handover** | `schema/fulfilment.ts`, `DeliveryUseCases.ts` |
| WhatsApp | Goldie's inbound parser already reads `type === 'location'` and turns it into the text `My location: <name, address> (lat, lng)`; **nothing stores the coordinate or links it to an order** | `domain/assistant/WhatsAppGoldie.ts` 77 |
| Checkout | `UgandaLocationPicker` (server search + offline fallback + district browse + manual text + GPS/pasted-link pin); one free-text "Exact address" field doubles as the landmark; `hasPin` never sent; SAME_DAY hardcoded to Kampala/Wakiso | `components/UgandaLocationPicker.astro`, `lib/locationPickerClient.ts`, `pages/checkout.astro` |
| Order storage | `orders.delivery_area`, `delivery_address` (the landmark text), `delivery_location` jsonb (district, areaSlug, gps*), `delivery_fee`, `delivery_fee_confirmed` | `schema/commerce.ts` |
| District list | `UGANDA_DISTRICTS` hard-coded (136 entries, the 2021 list) in `packages/shared/src/locations/uganda.ts`; `routes/commerce.ts` **rejects an order whose district is not on it** | |

Production Postgres is `postgres:16-alpine` with no PostGIS. `pg_trgm`, `unaccent`, `btree_gin` are already enabled
(migration 0084). `cube` is a trusted extension; `earthdistance` is **not** (verified on 16.14: needs a superuser,
which the compose migrator is). §3.6 gives the no-extension fallback.

---

## 2. Design principles

1. **The point is the fact; everything else is a label.** Districts, parishes, postcodes and area names are ways of
   finding and describing a point. Once an order has a point, no fee or route depends on which district it is said to
   be in. Labels are snapshotted on the order (`snapshot_*`), so a renamed or split district changes wording, never
   money. (§7 is the consequence for a map that keeps changing.)
2. **Every point carries its source and its expected error in metres, and neither is invented.** Version 1 gave
   sources made-up confidences (0.95, 0.75, 0.60); contract #4 forbids that. Version 2 ranks sources by an explicit
   precedence and stores `expected_error_m` only where it can be measured or stated: the dispersion of buildings or
   pins around the point, the polygon's equivalent radius, or the number an admin typed with a reason. Unknown is
   `null`, never a guess.
3. **Use the pins that already arrive before building a way to collect new ones.** WhatsApp location messages, pasted
   map links and the rider standing at the door are three pin sources that exist today. A map widget at checkout is
   the fourth and the least used in Uganda; it is Phase C, optional, and may never be needed.
4. **Measured distance enters the model through one switch.** `distance_source` in the registry: `band_midpoint`
   (today), `measured` (straight-line from the point × learned detour, exactly as MODEL.md already specifies), later
   `road` (routed km, detour 1.0). The Control Centre flips it, with a dry run, and it reverts in one action
   (contract #9).
5. **New data is validated against old data before it is trusted.** A matched polygon whose point lands 20 km from
   the band the team assigned by hand is wrong, or the band is; either way a person looks (§3.4).
6. **Open data first; paid APIs are optional enrichment behind a cache with an off switch** (brief PART L). The
   checkout works with Google and Mapbox both absent.
7. **The customer chooses from things they know:** area → landmark → "share your location on WhatsApp". Typing
   directions stays possible as the fallback.
8. **The rider gets everything the customer gave, in one message:** area, landmark, directions, Plus Code, map link,
   and how sure we are.

---

## 3. The point layer: one point per area

### 3.1 `geo_area_point`
> **Implementation note, Phase A.1 (PR #116, 2026-10-15).** The corridor rows already carried `centroid_lat / lng /
> source / sample_size` since migration 0092, read by the resolver and written to the capture, so Phase A.1 fills those
> and adds `centroid_expected_error_m`, `centroid_source_ref`, `centroid_shared_polygon`, `centroid_updated_at`
> (migration 0189) instead of creating this table. `geo_area_point` stays the design for points outside the metro
> set (Phase C). No Postgres extension was needed. See `docs/location/PHASE_A_RUNBOOK.md` on PR #116.

```sql
CREATE TABLE geo_area_point (
  area_slug         text PRIMARY KEY REFERENCES ug_area(area_slug),
  lat               double precision NOT NULL CHECK (lat BETWEEN -2.5 AND 5.5),
  lng               double precision NOT NULL CHECK (lng BETWEEN 28 AND 36.5),
  source            text NOT NULL CHECK (source IN ('rider_handover','delivered_pins','manual','parish_buildings','parish_centroid','osm_place','geonames','subcounty_centroid')),
  source_ref        text,                     -- parish PCODE | geonames id | osm type/id | 'pins:<n>' | admin note id
  expected_error_m  integer,                  -- measured dispersion or stated by an admin; NULL = unknown (never guessed)
  sample_size       integer NOT NULL DEFAULT 0,
  shared_polygon    boolean NOT NULL DEFAULT false,  -- several areas share one 2016 polygon (post-2016 split)
  -- no cached distance: delivery_origin can hold several origins, so km are computed at quote time (sub-millisecond)
  set_by            text,                     -- 'job:<name>' | admin user id
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX geo_area_point_latlng_idx ON geo_area_point (lat, lng);
```

**Source precedence** (highest wins; a job never downgrades; `manual` is never overwritten by a job):
`rider_handover` (≥3 handover pins, p90 spread ≤ 800 m) > `delivered_pins` (≥5 customer pins, p90 ≤ 1,500 m) >
`manual` > `parish_buildings` > `parish_centroid` > `osm_place` > `geonames` > `subcounty_centroid`.

**Expected error, by source, all measurable:**
- `rider_handover`, `delivered_pins`: p90 distance of the pins from their geometric median.
- `parish_buildings`: RMS distance of the buildings inside the polygon from their weighted centre.
- `parish_centroid`: two-thirds of the polygon's equivalent radius, `(2/3)·√(area/π)` (the mean distance from the
  centre of a disc to a uniformly placed point). Kampala's median parish (1.2 km²) gives 410 m; Wakiso's larger
  parishes give 1–2 km, which is the honest statement of how little a bare centroid tells you there.
- `manual`: the admin types it with a reason ("placed on the trading centre, ±200 m").
- `osm_place`, `geonames`: `null`. A settlement label has no measurable error; it inherits the containing polygon's
  figure only when it lies inside a matched polygon.
- `subcounty_centroid`: `(2/3)·√(area/π)` of the sub-county, typically 3–6 km. Shown to ops as what it is.

### 3.2 Where the first 362 points come from: parish polygons, weighted by buildings
The UBOS 2016 parish shapefile (Appendix A.9) has 357 parish polygons inside the GKMA box, and **350 of the shop's
390 metro-index entries (89%) match one by exact folded name today** (Kampala 94/109, Wakiso 139/148, Mukono 69/74,
Mpigi 48/59), and the
misses are spelling variants that trigram folding inside the lineage family (§7.2) closes.

A geometric centroid is the wrong point for delivery: Ggaba's 13 km² polygon has its centre away from where anyone
lives. OSM holds **1,567,904 building footprints** inside the GKMA box (HOT and AI imports). So the point for a parish
is the **centre of its buildings**: filter the Geofabrik `uganda-latest.osm.pbf` to `building=*` inside the box with
`osmium`, take each footprint's centroid, assign it to a parish by point-in-polygon (batch, 7,566 rings, bbox index
then ray-casting), and store the geometric median of the buildings as the area point with `source='parish_buildings'`
and `expected_error_m` = the RMS spread. A parish with fewer than 20 buildings in OSM (`area_point_min_buildings`, a registry key) falls back to
`parish_centroid`. The building extract is processed on the Mac; only the resulting points reach production, never
the 1.57 million footprints. This also fixes the Ggaba-type case with no manual work, and it is the same computation the
nightly pin job does later with delivered pins instead of buildings.

Quick alternative if the building extract is deferred: where GeoNames has a PPL of the same name inside the polygon,
use the PPL point (`osm_place`/`geonames` precedence) and keep the polygon as the container. It is weaker than the
building centre and should not outlive Phase A.

### 3.3 Parish splits and the things that are not neighbourhoods
- **One polygon, several current areas** (post-2016 splits; Mukono's EC parishes match the 2016 file only 68% of the
  time for this reason): every area in the split shares the polygon's point with `shared_polygon = true`. Pins separate
  them over time (§5.6); the admin page lists them under "shared polygon: needs pins or a manual point".
- **`ug_area.area_kind`.** The 2019 postcode tables list prisons, barracks, a university, national parks, mountains
  and lakes as parishes (Appendix B). A door delivery "to Queen Elizabeth" is not a thing.
  ```sql
  ALTER TABLE ug_area ADD COLUMN area_kind text NOT NULL DEFAULT 'neighbourhood'
    CHECK (area_kind IN ('neighbourhood','ward','trading_centre','institution','barracks','reserve','water','island','unknown'));
  ```
  Set by the importer from name patterns and reviewable in `/admin/locations`. `institution` and `barracks` are
  priced as their parish's point and the rider card says "institution: gate / reception"; `reserve`, `water`,
  `island` and `unknown` are never priced for door delivery and go to the manual path or pickup (the 12 lake areas
  already do this through `access_mode`).

### 3.4 Validation against the bands the team already assigned (new in v2)
`delivery_corridor` holds a hand-assigned band for every metro area. After matching, compute the straight-line km
from the HUB origin for each new point, and the same × 1.3 as an urban detour allowance (a report parameter, not a
model number: the bands were assigned by hand and may reflect road feel rather than straight line), and compare both
with the band's range (Appendix F). Three lists come out of the import, and a person reads all three before anything
is published:
- **consistent**: the point sits inside the band's range ± 2 km (the vast majority);
- **suspect match**: the point is more than one band away from the assigned band and the name match was fuzzy or
  the polygon is shared; the match is probably wrong;
- **suspect band**: the point is more than one band away, the match was exact and the polygon is unique; the band
  is probably wrong, which is the whole purpose of this work.
Nothing is written to `delivery_corridor.distance_band` by the import; the re-banding goes through the Control
Centre's corridor dry run (§4.1). The dry run must also list areas whose **fulfilment mode** would change: an area
moving past `own_rider_max_band` flips from own rider to bus parcel or pickup, which matters more to a customer than
the fee.

### 3.5 `geo_admin_polygon` (batch only in Phase A)
```sql
CREATE TABLE geo_admin_polygon (
  id             serial PRIMARY KEY,
  level          text NOT NULL CHECK (level IN ('district','subcounty','parish')),
  boundary_set   text NOT NULL,              -- 'ubos-2016' | 'hdx-2020' | later sets; several coexist, none deleted
  valid_from     date, valid_to date,
  source_ref     text NOT NULL,              -- PCODE or HDX pcode
  district       text NOT NULL, county text, subcounty text, name text NOT NULL,
  area_slug      text REFERENCES ug_area(area_slug),
  bbox_s double precision NOT NULL, bbox_w double precision NOT NULL, bbox_n double precision NOT NULL, bbox_e double precision NOT NULL,
  ring_wgs84     jsonb NOT NULL,             -- outer ring [[lng,lat],...], simplified to ≤500 points
  area_km2       numeric(8,3)
);
CREATE INDEX geo_admin_polygon_bbox_idx ON geo_admin_polygon (level, bbox_s, bbox_n, bbox_w, bbox_e);
```
Used by the import scripts and the nightly job (point-in-polygon in application code). The request path never
touches it in Phase A: a pin is assigned to an area by the nearest `geo_area_point` within the chosen lineage family
and 3 km, which is one indexed query. PostGIS (`ST_Contains`, KNN `<->`) is the upgrade when polygons are needed on
the request path (§13.4); not before.

### 3.6 Distance in SQL without `earthdistance`
`cube` is trusted, `earthdistance` is not; the migrator is the superuser so `CREATE EXTENSION earthdistance` should
pass the rehearsal. If it does not, no extension is needed: prefilter by bounding box on the `(lat, lng)` btree
(±0.025° ≈ 2.8 km) and compute the haversine in SQL,
`6371000 * acos(least(1, cos(radians(lat1))*cos(radians(lat2))*cos(radians(lng2-lng1)) + sin(radians(lat1))*sin(radians(lat2))))`.
At ≤100k points either way is sub-millisecond. Every query in this spec is written so the twin is a one-line swap.

---

## 4. Distance: straight-line now, road later

### 4.1 Phase A needs no router
MODEL.md §3 already says what happens when a centroid exists: `round_trip_km = straight_line × 2 × detour_factor`,
and `detour_factor` is learned per corridor from "actual against straight-line distance". So the only wiring Phase A
needs is `DeliveryAreaResolver.measuredKm ← haversine(active origin, geo_area_point)` (today it is always `null`, lines
70/85/138; computed at quote time because `delivery_origin` can hold more than one origin),
and the capture's existing `straight_line_km` and `centroid_source` columns get written. Version 1 put OSRM routing on
the critical path and then double-counted detour; both are gone.

The **`distance_source` registry key** controls what the model sees:
- `band_midpoint` (default, today's behaviour);
- `measured`: the model prices each destination by its own straight-line km × detour;
- `road`: as `measured`, but `geo_road_distance.road_km` replaces straight-line × detour where a routed value exists
  (detour applied as 1.0 and `router` recorded in the capture).

**Re-banding is not a distance source; it is an operation on the corridor data.** Measured km feed the existing
corridor dry run, the team reviews which areas move band, and publishes. That can be done while `distance_source`
stays `band_midpoint`, which is the recommended first month: fees look exactly as they do now and only the wrongly
banded areas move. What the customer *sees* is a separate key, `fee_shape` (§4.5).

### 4.2 `geo_road_distance` (Phase D)
```sql
CREATE TABLE geo_road_distance (
  origin_code      text NOT NULL REFERENCES delivery_origin(origin_code),
  target_kind      text NOT NULL CHECK (target_kind IN ('area','landmark','pin_cell')),
  target_key       text NOT NULL,             -- area_slug | landmark id | geohash-7 cell (~150 m) of a pin
  straight_km      numeric(6,2) NOT NULL,
  road_km          numeric(6,2),
  road_minutes_freeflow numeric(6,1),
  router           text,                      -- 'osrm-offline:<pbf date>' | 'google-routes' | 'mapbox-directions'
  computed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (origin_code, target_kind, target_key)
);
```
Router, in preference order: **OSRM offline on the Mac** (`osrm-extract` + `osrm-contract` on `uganda-latest.osm.pbf`,
car profile, 2–4 GB RAM while building, then one `/table` call from the hub to every point; free, no runtime service;
re-run quarterly); Google Routes `computeRouteMatrix` (10,000 free elements/month, 1 origin × ≤1,000 targets is inside
it); Mapbox Matrix (100,000 free). A boda does not drive like a car: road km is a better *distance* than straight-line
× detour, but minutes still come from the learned speed and hour factors, which is why road km is Phase D and not A.

### 4.3 Why points come before calibration
With band midpoints, a Ntinda order that took 20 minutes longer than expected teaches the model nothing it can place:
was the distance wrong, the detour, the hour, the rider? With a measured point the distance term is fixed and the
calibration proposals (which exist) can attribute the residual to `hour_factor` and `corridor_factor`, which is what
they were built for. `eat_hour_of_week` is already captured per order; it becomes useful the day distance stops
being a guess.

### 4.4 Price surfaces on a grid: learning scopes that survive every boundary change
Learned factors and window percentiles are keyed by `scope_key`, a free string (`delivery_learned_factor`,
`delivery_window_percentile`, `delivery_calibration_proposal`); today the scopes are corridors, bands and areas, which
are all *names*. Names change (§7). A **cell** does not: geohash-6 of the destination point is a 1.2 km × 0.6 km box
that is the same box in 2030. Once orders carry points (§5), the nightly calibration also writes scopes
`cell:<geohash6>` for observed minutes, last-mile minutes and window percentiles, with the cell's corridor as the
prior and shrinkage toward it until the cell has enough samples (`(n·cell + k·corridor)/(n + k)`, `k` a registry
key). A cell is also what a pin maps to when the area is unknown (manual path with GPS, or a WhatsApp pin from a
customer with no account). Honest about volume: at roughly a thousand metro orders a month across a few hundred
cells, most cells take months to reach five samples; the corridor prior does the work meanwhile, and the map of
Kampala delivery minutes that accumulates belongs to the shop. No new table; no change to what the customer sees;
`geohash` is forty lines of code and already proposed for pin cells (§4.2).

### 4.5 Fee shape: continuous, or a ladder the owner prices and the model places
The model turns minutes into cost. How the *fee* is presented is a separate choice, `fee_shape`:
- `continuous` (today's design): `max(min_fee, cost × margin)` rounded to `fee_rounding_step_ugx`.
- `ladder`: the owner sets a short list of price points (the example 3,000 / 5,000 / 8,000 / 12,000 / 20,000 is an
  illustration, not a recommendation; contract #4), and the model places each destination on the **lowest rung
  whose price covers modelled cost × margin**. Customers and riders in Kampala already talk this way ("Ntinda is
  8k"); fees are round and memorable; re-banding and measured distance stay invisible until they change a rung; the
  owner changes prices without touching the model. The rung is a function of minutes, so the fee and the window still
  come from the same number (contract #2): a ladder is a quantisation of the model, not a second model. The
  **margin alarm** in the Control Centre lists any rung where modelled cost exceeds its price for more than an
  owner-set share of orders, which is the signal to add a rung or move to `continuous`. `fee_ladder` is a versioned
  registry value with a dry run that shows which areas change rung.
Why ladder first: it is the smallest change in what customers see for the largest change in what the shop knows.
Why not forever: a ladder hides real cost differences inside a rung; the margin report says when that starts to cost
money.

### 4.6 Costs that fall honestly: the pin nudge the model already justifies, meeting points, pickup, batching
MODEL.md's equation has `last_mile_minutes(area, has_pin, landmark_quality)`, and its calibration list already says
last-mile "split by pin present or absent … is what justifies the pin nudge to customers". Phase A writes
`accuracy_tier` on every capture, so last-mile minutes and first-attempt success get learned **per tier** (PIN,
LANDMARK as a meeting point, LANDMARK as a hint, AREA_POINT, DISTRICT) with today's single value as the prior. The
fee difference between tiers then *falls out of the model*: a pinned address costs less because it measurably takes
fewer minutes and fewer second trips. The registry already holds the copy key for this, `copy_pin_nudge`; it is shown only when the learned difference
exists and is at least one rounding step: "Share your location and delivery is UGX X less", which is true, cost-based and ethical
(CLAUDE.md: no invented discounts, no fake urgency). The same mechanism prices, without any special rule:
- **meeting points** (§6.5): less last-mile, so cheaper when the data says so;
- **collection at the shop**: zero travel, the floor is the handling cost;
- **dealer pickup points**, when the owner wants them: `ug_pickup_point` has 0 rows and the dealer network (PR #80)
  is the obvious seed; a pickup option appears in the same quote with its own tier and fee;
- **batching**: riders take several stops per trip, and the model prices each order as a dedicated round trip, so on
  batched days `actual_rider_cost_ugx` per order undercuts the quote. The existing margin report shows it; a
  `stops_on_trip` count on the dispatch (later) lets margin be set from evidence instead of padded. Rain and public
  holidays are not captured; `hour_factor` absorbs the regular part, and nothing is invented for the rest.

---

## 5. Pins without a map: the channels that already exist

### 5.1 WhatsApp location messages (highest value, smallest change)
A customer taps the paper-clip and "Location" in WhatsApp; Meta delivers `type: 'location'` with `latitude`,
`longitude`, optional `name` and `address`. Goldie's parser already reads it (`WhatsAppGoldie.ts` 77) and then
throws the numbers into a text line. Change:
1. `GoldieChannelUseCases` passes location messages to a new **`AttachLocationToOrderUseCase`**: find the sender's
   most recent order (by the order's phone, E.164-normalised) that is `placed`, `confirmed` or `dispatched` and has
   no handover yet; store the pin on the order (`delivery_location.gps*` with `gpsSource='whatsapp_location'`), on the
   capture (`had_pin = true`, accuracy tier PIN), and on the customer's saved address if one matches the area. The use case runs *before* the assistant composes a
   reply and answers deterministically ("Got it, the rider has your pin"); when the phone has more than one open
   order it asks which one with buttons.
2. The order-confirmation WhatsApp template (templates exist in `whatsAppTemplates.ts`) gains one line: *"Reply with
   your location pin (📎 → Location) so the rider finds you first time. Not there now? Open the map and drop the pin
   where we should deliver."* WhatsApp lets a customer send any point, not only where they stand, which matters because
   many orders are placed from work. No new screen, no map of ours, nothing to install. The confirmation message is a Meta-approved template, so the
   new line goes through template review before it can be sent (days, not weeks).
3. Contract #5: the quote for that order does not change because a pin arrived later; the pin improves the rider card
   and the learning loop. If the pin lands more than 5 km from the chosen area's point, ops are told ("pin
   disagrees with the area") rather than anything being silently re-priced.
4. **Fee quotes on WhatsApp.** The same inbound pin, when the sender has no open order, answers "what's delivery to
   here?": Goldie calls the one quoting service (contract #1) with `{point}` and replies with the fee and window the
   model gives. Click-to-WhatsApp ads are live; this makes the first question those customers ask answerable.

### 5.2 The rider at the door (highest accuracy)
Riders are `rider_name` free text on a dispatch; there is no rider app and should not be one. Two routes, the first
needs no new screen at all:

**Route A, the rider sends a WhatsApp location to the shop's number at handover.** Goldie's parser already reads it
(§5.1). `fulfilment_dispatches` gains `rider_phone`; an inbound location from a phone with an active dispatch is a
handover pin for the stop nearest to it, and Goldie replies with buttons: **Delivered** / **Customer not there** /
**Couldn't find it**, then **Easy to find** / **Hard to find**. The answers go to `DeliveryUseCases.recordDelivery`
(exists; gains optional `handover_lat/lng/accuracy_m` and `find_difficulty`). That is the delivery record ops type in
the office today, captured at the moment it happens, with the best coordinate the system will ever have for that
address, plus a measured "hard to find" signal that becomes `last_mile_minutes` evidence per area and per tier
(§4.6). A message the shop sends a rider first needs an approved template or a rider who has written to the number
in the last 24 hours; the dispatch message is a template, and one "hi" from each rider when they start is enough for
the rest.

**Route B, a signed link per stop** (`/d/<token>`, bound to the dispatch, 48 h), texted with the dispatch, opening a
page with the same buttons that asks for location once (`navigator.geolocation`, `enableHighAccuracy`). Same use
case underneath. Build it only if riders turn out not to use Route A.

`source='rider_handover'`, accepted at accuracy ≤100 m and within 5 km of the order's area point, or of any area point in its lineage family when it has none (a pin from the
hub or the wrong stop is rejected with a reply, not stored), precedence above every other source in §3.1.

### 5.3 Pasted links and device GPS at checkout (exist; wire them)
`/locations/resolve-link` and the "Share my location" button exist. Changes: send `hasPin` and the point in the quote
and order payload (today dropped); accept device accuracy ≤100 m, otherwise "we couldn't get a precise location;
choose a landmark instead"; add a Plus Code field validated offline with `open-location-code` (a short code is
expanded with the area point as reference). No map tiles are needed to accept a pin; a map is only needed to *drag*
one, which is §13.3 and optional.

### 5.4 The second order is always accurate
When an order is delivered with any pin, the pin is written to the customer's saved address (`addresses.gps_*`,
`gps_source='delivered'`, `resolution_status='verified'`). The next checkout for that address starts at tier PIN and
the landmark step is skipped. Today the save-address flow drops `areaSlug`, `landmarkText` and `gps*`; fix that in
the same change.

### 5.5 Accuracy tier on every capture
```sql
ALTER TABLE delivery_quote_capture
  ADD COLUMN accuracy_tier text CHECK (accuracy_tier IN ('PIN','LANDMARK','AREA_POINT','BAND_MIDPOINT','DISTRICT')),
  ADD COLUMN point_lat double precision, ADD COLUMN point_lng double precision,
  ADD COLUMN point_source text,            -- 'device' | 'pasted_link' | 'plus_code' | 'whatsapp_location' | 'saved_address' | 'rider_handover'
  ADD COLUMN landmark_id uuid REFERENCES ug_landmark(id),
  ADD COLUMN plus_code text;
-- straight_line_km, centroid_source, had_pin already exist and are now written. No road_km column: it lives in geo_road_distance.
```
`had_pin` becomes derived (`accuracy_tier = 'PIN'`). Appendix F says what each tier means for the rider.

### 5.6 Nightly: pins become area points (`geo-nightly-area-points.ts`)
For each `area_slug`: take handover pins from the last 365 days with accuracy ≤100 m; if ≥3 and p90 spread ≤ 800 m,
write `source='rider_handover'`. Else take customer pins (any `point_source` except `saved_address`) from delivered
orders with `first_attempt_success`; if ≥5 and p90 ≤ 1,500 m, write `source='delivered_pins'`. A spread above the
limit is logged and listed in `/admin/locations` ("wide-spread area: probably two areas or an alias covering
several") and the existing point is left alone. The job never overwrites `manual`. It also gives a point to any
`ug_landmark` without one that ≥3 delivered orders referenced.

### 5.7 Privacy (DPPA 2019)
A pin is personal data, and a handover pin is the customer's front door. Keep the brief's PART K: pins live with the
order and the saved address, are used for delivery and for the aggregate area point, and raw pins are deleted after
the retention period the owner sets (recommended 180 days; the aggregate point keeps no per-customer data). The
nightly job reads only inside the window. The rider link shows the rider the pin for that stop only and dies with the
token. `rider_phone` is a worker's personal data: kept on the dispatch for matching, masked in admin like the
recipient's contact.

---

## 6. Landmarks: what customers already say, then what the map knows

### 6.1 Mine the shop's own orders first (new in v2; zero licence, highest relevance)
`orders.delivery_address` and `addresses.landmark_text` already hold every landmark customers have typed: "near
Capital Shoppers", "opposite Shell Ntinda", "behind Kabira Country Club". A one-off script
(`geo-mine-order-landmarks.ts`) splits each text on `near|opposite|opp\.?|next to|behind|after|before|off|at|close
to|by`, takes the proper-noun phrase that follows, folds it, and counts phrases per `area_slug`. Phrases used by ≥2
distinct customers become `ug_landmark` rows with `source='order_text'`, `usage_count` = the count, no point yet.
They are the first list the checkout shows for that area, because they are the words that area's customers use. Points
arrive by name match to OSM (§6.2) or by the first delivered pin that references them (§5.6).
`ug_search_miss` is mined the same way: a query with `result_count = 0` that was later `resolved_via` an area is an
alias candidate for that area (the table already records what it became).

### 6.2 OSM (ODbL) for points and categories
Counts inside the GKMA box are in Appendix A.3: schools 2,430, places of worship 622, banks 461, pharmacies 424,
supermarkets 409, police 158, markets 143, bus stops 88, boda/taxi stages only 82. Import from the Geofabrik extract
with `osmium` (Appendix C), categories school | church | mosque | hospital | clinic | pharmacy | bank | market | mall |
supermarket | fuel | police | stage | bus_stop | office | other, `source='osm'`, `source_ref='node/<id>'`,
`last_seen_at`. Unnamed objects are skipped except stages, which take a generated name from the nearest named road
or place ("Boda stage, Kira Road / Bukoto"). A row absent from two consecutive imports gets `active=false`; nothing is
deleted (orders reference it). `place=suburb|neighbourhood|village|hamlet|locality` nodes are area-point candidates
(`osm_place`), not landmarks.

### 6.3 Electoral Commission polling-station names (public data; names only, no coordinates)
34,684 stations in the 2020 register name the schools, churches, mosques, LC1 offices and grounds locals know
(Appendix A.4 and E for the normalisation rules). Phase C: match each normalised name to an OSM landmark with a point
in the same lineage family (trigram ≥ 0.6 and the same category word), add the EC spelling as an alias; unmatched
names become landmarks without a point, selectable, quoted at the area's point (tier AREA_POINT) until a delivery
gives them one. Parishes in the EC list missing from `ug_area` are upserted as candidate areas
(`selectable=false`, `data_version='ec2020'`) for the admin to promote.

### 6.4 `ug_landmark` extension
```sql
ALTER TABLE ug_landmark
  ADD COLUMN source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','order_text','osm','geonames','ec_station','order_pin','rider')),
  ADD COLUMN source_ref    text,
  ADD COLUMN category      text,
  ADD COLUMN expected_error_m integer,      -- NULL unless measured (pins) or stated (manual)
  ADD COLUMN aliases       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN normalised    text,
  ADD COLUMN active        boolean NOT NULL DEFAULT true,
  ADD COLUMN last_seen_at  timestamptz,
  ADD COLUMN sub_county    text, ADD COLUMN parish text,
  ADD COLUMN is_meeting_point boolean NOT NULL DEFAULT false;   -- "deliver to this place", not "I am near it"
CREATE INDEX ug_landmark_latlng_idx ON ug_landmark (gps_lat, gps_lng) WHERE gps_lat IS NOT NULL;
CREATE INDEX ug_landmark_norm_trgm ON ug_landmark USING gin (normalised gin_trgm_ops);
CREATE UNIQUE INDEX ug_landmark_source_ref_uq ON ug_landmark (source, source_ref) WHERE source_ref IS NOT NULL;
```
`area_slug` is set by nearest `geo_area_point` within the lineage family and 1,500 m, else null and `active=false`
until an admin places it.

### 6.5 Meeting points (new in v2)
Many Kampala deliveries are handed over at a place, not a home: the mall entrance, the office gate, the stage. The
landmark step offers two choices for a chosen landmark: **"I'm near here"** (the landmark is a hint; directions still
wanted) and **"Meet me here"** (the landmark *is* the destination; tier LANDMARK, no directions needed, rider card
says "meet at"). Failed first attempts are mostly "couldn't find the house"; a meeting point removes the house from
the problem. `is_meeting_point` marks landmarks that have been used that way, so they rank first for that choice.

### 6.6 Suggestion query (request path)
```sql
SELECT l.id, l.name, l.category, l.usage_count, l.is_meeting_point,
       earth_distance(ll_to_earth(l.gps_lat, l.gps_lng), ll_to_earth($lat, $lng)) AS metres
FROM ug_landmark l
WHERE l.active AND (l.area_slug = $area_slug OR (l.gps_lat IS NOT NULL
      AND earth_box(ll_to_earth($lat, $lng), 2500) @> ll_to_earth(l.gps_lat, l.gps_lng)))
ORDER BY (l.area_slug = $area_slug) DESC, l.usage_count DESC, metres NULLS LAST
LIMIT 12;
```
Landmarks without a point (order text, EC names) are included for their own area, ranked by usage; they are what
customers say, and they get a point the first time a delivery references them.

---

## 7. Districts and a map that keeps moving

Uganda added districts in almost every parliament: 34 in 1990, 56 in 2000, 80 in 2006, 112 in 2010, 135 at the 2021
election, **146 districts and cities in the Electoral Commission's 2025 count**, with three more districts and Tororo
City approved in April 2025. Sub-counties, town councils, parishes and wards split more often still. Postcodes were
assigned once, in 2019, to a district list that was out of date within a year. Every source this spec uses has its
own district list (2016 polygons 116; 2019 postcodes 128; `ug_area` 135 + Terego; EC 2020 135; EC 2025 146; the
EC 2025/26 electoral selector 222 because it counts cities and municipalities separately). The rules:

### 7.1 Never refuse a district (contract #8)
`routes/commerce.ts` rejects a district that is not in the hard-coded 2021 list, so a customer in a district created
since cannot check out through the structured path until a developer ships a build. Change: accept any district
string that normalises to a known district (the constant list today; `ug_district` with its aliases, active or
proposed, once it is seeded), and otherwise accept it as
`district_unverified` on the manual path. Unknown never blocks a sale; it goes to the queue a person already handles.
This is a ten-line change and ships in Phase A ahead of the tables below.

### 7.2 Districts are data; matching runs inside a lineage family
```sql
CREATE TABLE ug_district (
  district          text PRIMARY KEY,         -- canonical, Title Case, as normalizeUgandaDistrict() returns it
  kind              text NOT NULL CHECK (kind IN ('district','city','capital_city')),
  region            text NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','proposed','merged','renamed')),
  effective_from    date,
  aliases           text[] NOT NULL DEFAULT '{}',   -- {'Luwero','Luweero'}, {'Sembabule','Ssembabule'}
  postcode_prefixes text[] NOT NULL DEFAULT '{}',   -- {'313','314'} for Wakiso; empty for districts newer than 2019
  ec_codes          text[] NOT NULL DEFAULT '{}',
  data_version      text NOT NULL,                  -- 'ec-2025' | 'gazette-2025-04' | 'manual'
  notes             text
);
CREATE TABLE district_lineage (
  child          text NOT NULL REFERENCES ug_district(district),
  parent         text NOT NULL REFERENCES ug_district(district),
  effective_from date,
  source         text NOT NULL,                     -- 'gazette' | 'ec-list' | 'manual'
  PRIMARY KEY (child, parent)
);
```
A **lineage family** is the transitive closure: a district, its parents, and every sibling carved from the same
parent. The 2016 district is always an ancestor, so every current district resolves to a 2016 polygon set. A city and
the district it was carved from are one family (a customer saying "Mbarara" means either; the quote comes from the
point, so it does not matter). **Every name match between datasets is accepted only inside one family**: version 1
matched "within the same district", which fails silently for every district created after 2016.

Seed: the EC's 2025 list of 146, reconciled with the 2021 list in code, plus the known post-2016 creations
(Kassanda ← Mubende; Kikuube ← Hoima; Bugweri ← Iganga; Kapelebyong ← Amuria; Nabilatuk ← Nakapiripirit; Kwania ←
Apac; Kazo ← Kiruhura; Kitagwenda ← Kamwenge; Rwampara ← Mbarara; Kalaki ← Kaberamaido; Obongi ← Moyo; Madi-Okollo
and Terego ← Arua; Karenga ← Kaabong; Rukiga ← Kabale; Bunyangabu ← Kabarole; Namisindwa ← Manafwa; Butebo ← Pallisa;
Kyotera ← Rakai; Pakwach ← Nebbi; Omoro ← Gulu; Kagadi and Kakumiro ← Kibaale), the ten 2020 cities, and the 2025
approvals as `proposed` (Mukuju, Mulanda, the third Tororo district, Tororo City). The seed lives in the repo as
`data/locations/district-lineage.csv` (versioned, reviewed in a PR); the admin "new district" form (§7.4) is Phase C.
The importer's existing 140 `district_changed` rows are the first lineage evidence. `ug_area.current_district` gains a
foreign key to `ug_district` once seeded. The shared TypeScript constant is regenerated from the table at build time
and kept only as the offline fallback.

### 7.3 Boundaries, slugs, names
- **Boundary sets are additive.** A new UBOS file loads as another `boundary_set`; old sets stay (order history and
  `source_ref` reference them). "Current set" is a registry key; a refresh produces a dry run of areas whose point or
  band would change, and goes through the Control Centre like any corridor change. Bands are never recomputed silently.
- **`area_slug` is opaque.** It contains the 2019 postcode (`kampala-nakawa-10318`) but nothing may parse it. Areas
  added later get a synthetic suffix (`wakiso-bulindo-x0007`) and `postcode = null`; a future national renumbering
  updates `ug_area.postcode`, never the slug.
- **Names collide more as districts multiply** ("Kampala" parish in Sembabule, "Jinja" in Busia and in Kampala,
  "Kibuye" in Kampala and Kamuli). `delivery_name_collision` (84 rows) stays the guard; the family rule keeps
  cross-district false matches out; the resolver's `AREA_TOO_COARSE` for a bare district name stays.
- **Customer wording tolerates change.** Saved addresses show the words the customer used (`snapshot_area_label`,
  `snapshot_district`) after the official name moves on; search accepts old and new names through `aliases`.

### 7.4 The yearly drift report (`geo-admin-drift-report.ts`)
Run each July after the financial-year changes and after every election register: fetch the current EC
district/constituency/sub-county list and UBOS's statistical-abstract tables, diff them against `ug_district` and
`ug_area`, and write to `/admin/locations`: new districts (with the parent the Gazette names), renames, parishes in
the EC list missing from `ug_area` (candidates, `selectable=false`), areas whose district label changed. Nothing is
applied automatically; each line is a one-click admin action with an audit row. Sources of truth, in order: the
Uganda Gazette / Parliament resolution; the EC's lists; UBOS. News reports prompt a check of the Gazette and are never
a source. **This needs a named owner (§12, decision 7); without one the lists rot exactly as the hard-coded one did.**

---

## 8. Checkout and the rider card

Keeps `UgandaLocationPicker`; adds one step and one sentence. Mobile-first; the area step works offline (existing
index).

1. **Area** (exists): "Ntinda, Kampala · Nakawa Division".
2. **Landmark** (new, §6): "Nearest place everyone knows", up to 12 from `/locations/landmarks?area=<slug>`, grouped by
   category with icons; type-ahead over `normalised`. "I'm near here" or "Meet me here" (§6.5). "None of these"
   keeps the free-text field, renamed **"Directions for the rider"** (gate colour, floor, "after the mosque, blue
   gate"), required only when there is no landmark and no pin.
3. **Pin** (exists, wired per §5.3): share location, paste a link, or a Plus Code. One sentence under it: *"Or send us
   your location on WhatsApp after you order."* With a pin, the landmark list re-sorts by distance to it.
4. **Quote** (exists): `/delivery/quote {areaSlug, landmarkId?, point?}` returns `accuracyTier` and copy per tier from
   the registry: PIN / LANDMARK / AREA_POINT → the fixed quote; BAND_MIDPOINT → "estimate; confirmed when we call";
   DISTRICT → "Confirmed by phone before dispatch" (unchanged).
5. **Order payload**: `deliveryLocation` gains `landmarkId`, `landmarkName`, `meetingPoint`, `plusCode`,
   `accuracyTier`, `pointSource`; `deliveryAddress` keeps the directions text; save-address keeps everything (§5.4).
6. **Pickup** (exists): store `pickup_point_id` (today text only).
7. **Rider card** (`admin/orders/[id].astro` and the dispatch WhatsApp): area, landmark (+ "meet at" when a meeting
   point), directions, Plus Code, `https://maps.google.com/?q=<lat>,<lng>`, accuracy tier badge, and the handover link
   (§5.2).

Failure paths: landmark service down → step 2 skipped silently; pin refused → "choose a landmark instead"; offline →
area step only, directions required. Copy follows `docs/customer-language-standard.md`: "boda stage" not "taxi
rank"; never "GPS coordinates" in customer copy.

---

## 9. Changes to existing code

| File | Change | Phase |
|---|---|---|
| `routes/commerce.ts` | accept unknown districts as `district_unverified` → manual path (§7.1); zod for `landmarkId`, `point {lat,lng,accuracyM,source}`, `plusCode` `^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}$`, `meetingPoint`; the quote cache key in `routes/delivery.ts` (today area + basket + config version) gains the pin's geohash-7 cell or the landmark id, otherwise a pinned quote would be served from the area's cached fee | A / C |
| `infrastructure/delivery/DeliveryAreaResolver.ts` | `measuredKm` ← pin (haversine from hub) → landmark point → haversine(active origin, `geo_area_point`) → null; return `accuracyTier`, point, `centroidSource` | A |
| `domain/delivery/DeliveryConfigRegistry.ts` | `distance_source` (band_midpoint \| measured \| road), `fee_shape` (continuous \| ladder), `fee_ladder` (versioned rungs), `cell_shrinkage_k`, `last_mile_minutes` learned per accuracy tier (prior = today's value), `pin_max_accuracy_m` 100, `handover_pin_max_accuracy_m` 100, `landmark_suggest_radius_m` 2500, `area_point_min_pins` 5, `area_point_max_spread_m` 1500, `handover_min_pins` 3, `handover_max_spread_m` 800, `pin_retention_days`, copy per tier, `enrichment_provider` none\|google | A |
| `domain/delivery/DeliveryModel.ts` | honour `distance_source`; `fee_shape = ladder` maps minutes to a rung (§4.5); `last_mile_minutes` read per accuracy tier (§4.6); when `road`, `round_trip_km = road_km × 2` with detour 1.0 and `router` in the capture | A (switch, ladder), B (tiers), D (road) |
| `DeliveryCalibrationUseCases.ts` (exists; no scheduler for it is in the repo, so confirm the timer on the host and add one if it is missing) | add `cell:<geohash6>` scopes with corridor shrinkage (§4.4); margin alarm per rung (§4.5) | B |
| `application/use-cases/delivery/DeliveryQuotingUseCase.ts` | accept `landmarkId`, `point`; pass `hasPin`; write `straight_line_km`, `centroid_source`, `accuracy_tier`, `point_*` to the capture; honour `delivery_corridor.fulfilment_mode` (today `declaredMode: null`, a known gap) | A |
| `application/use-cases/assistant/GoldieChannelUseCases.ts` + new `AttachLocationToOrderUseCase` | route `location` messages to the sender's open order; fee quote from a pin when no order (§5.1) | B |
| `whatsAppTemplates.ts` | one line in the order-confirmation template asking for a location pin | B |
| `fulfilment/DeliveryUseCases.ts`, new `pages/d/[token].astro`, dispatch WhatsApp | rider handover link: outcome + pin (§5.2) | B |
| `CheckoutUseCase.ts`, `routes/account` save-address | keep `areaSlug`, `landmarkText`, `gps*` on saved addresses; write the delivered pin back (§5.4); bump `ug_landmark.usage_count` | B |
| `routes/locations.ts` + new `LandmarkSuggestUseCase` | `GET /landmarks?area=&q=&near=lat,lng`; `POST /resolve-link` also decodes Plus Codes | C |
| `checkout.astro`, `lib/checkout.ts`, `locationPickerClient.ts` | landmark step, meeting point, Plus Code, payload fields; same-day eligibility by band (registry) instead of the hard-coded Kampala/Wakiso list | C |
| `admin/orders/[id].astro` | rider card additions (§8, item 7) | B |
| `admin/locations.astro` | landmark registry tab; "shared polygon" and "wide-spread" lists; band-consistency report (§3.4); new-district form | A (report), C (rest) |
| `scripts/generate-locations-index.ts` | `lat/lng` per metro area in the offline index; district list from `ug_district` | A |
| `packages/shared/src/locations/uganda.ts` | generated from `ug_district` at build time; offline fallback only | C |
| `docs/delivery/MODEL.md` §3 | one paragraph: the centroid precedence now has a concrete table and a `distance_source` switch | A |

Nothing is deleted. The legacy `delivery_zones` fallback stays until PROGRESS.md §7's hard stop is lifted.

### 9b. Build rules, dependencies, and the tests that must exist
- **Architecture (CLAUDE.md):** reprojection, name folding, point-in-polygon, geohash and ladder placement are pure
  functions (`packages/shared/src/geo/` or `domain/delivery/`), with no Drizzle or Hono imports; every write goes
  through a use case; the scripts call use cases the way the existing importers do.
- **Migration:** Phase A is `0189_geo_points.sql` (0188 is the last applied). It is rehearsed by
  `scripts/deploy-prod.sh` like every migration; the `CREATE EXTENSION` lines come first so the rehearsal fails fast
  if the role lacks superuser, in which case the §3.6 fallback applies.
- **Dependencies (none of them present today):** `proj4` (EPSG:21036 with `+towgs84=-160,-6,-302`), `ngeohash`,
  `open-location-code`. Small, pure JavaScript, no native code.
- **Mac-side tooling:** `brew install osmium-tool`; `uganda-latest.osm.pbf` is a few hundred MB and an OSRM build
  needs several GB of scratch, so run them after the Downloads clean-up (6.4 GB free on 2026-10-15) and never on the
  4 GB production host.
- **Tests (vitest; mandatory):** reprojection of the four verified points within 30 m (Civic Centre, Kabalagala,
  Ntinda, Bugolobi); folding maps the twelve Kampala spelling variants in Appendix A.9 to their index entries and
  nothing else; lineage families (Kazo matches inside Kiruhura's family; "Kampala" parish in Sembabule never matches
  Kampala); the band report puts a synthetic 30 km "Ntinda" under *suspect match*; `expected_error_m` is null for a
  GeoNames point outside any polygon; ladder placement picks the lowest covering rung and the margin alarm fires on a
  rung below cost; an unknown district is accepted as `district_unverified`; a WhatsApp location attaches to the
  newest open order and asks when there are two; a handover pin 6 km from the area point is rejected with a reply;
  the nightly job never overwrites `manual` and skips a 1,501 m spread; every capture row carries an `accuracy_tier`;
  the quote cache key differs for two pins in different cells.

---

## 10. Data pipelines (scripts under `apps/api/src/scripts/`, idempotent, MD5-gated like the existing importers)

| Script | Input | Writes | Phase |
|---|---|---|---|
| `geo-import-parish-polygons.ts` | `Ug_Parishes_2016.shp/.dbf` (EPSG:21036 → 4326: Transverse Mercator inverse on Clarke 1880 RGS, then the EPSG:1122 shift dX −160 dY −6 dZ −302) or the derived `ug_parishes_2016_centroids_wgs84.csv` plus rings; `gkma-buildings.geojsonl` from `osmium` (Appendix C); `district-lineage.csv` | `geo_admin_polygon` (parish rings, bbox, area), `geo_area_point` (`parish_buildings`, else `parish_centroid`) for every area whose folded name matches uniquely inside its lineage family (exact, then trigram ≥ 0.6, unique best only), `ug_area.area_kind`, `shared_polygon`; the three-list band-consistency report (§3.4); HDX sub-county polygons for districts outside the 2016 file | A |
| `geo-import-villages.ts` | `locations-uganda` JSON (135 → 303 → 2,120 → 10,365 → 71,250 names) | `ug_village` (name, normalised, parish, sub-county, district, `area_slug` by the same folding); a search layer that returns the parent area, so "Bulindo" resolves to Kira's area | A |
| `geo-import-geonames.ts` | `UG.txt` (Appendix D) | `geo_area_point` (`geonames`) only where no polygon point exists; PPL-in-polygon preference per §3.2 | A (gap fill) |
| `geo-mine-order-landmarks.ts` | `orders.delivery_address`, `addresses.landmark_text`, `ug_search_miss` | `ug_landmark` (`order_text`), alias candidates | B |
| `geo-import-osm.ts` | `gkma-pois.geojsonl` from `osmium` (fallback: Overpass per tag, Appendix C) | `ug_landmark` (`osm`), `geo_area_point` (`osm_place`) | C |
| `geo-import-ec-stations.ts` | `voter_register_summary_2020.csv` (GKMA first, national later) | candidate areas, landmark aliases, pointless landmarks (§6.3) | C |
| `geo-nightly-area-points.ts` | pins in the retention window | `geo_area_point` (`rider_handover`, `delivered_pins`), landmark points | B onward, nightly |
| `geo-compute-road-distances.ts` | OSRM offline / Google Routes / Mapbox | `geo_road_distance`, re-banding dry-run CSV | D, quarterly |
| `geo-admin-drift-report.ts` | EC and UBOS lists | report rows for `/admin/locations` | yearly (§7.4) |

Every script prints a report and refuses to apply when its matched count drops by more than 10% from the previous
run (regression guard). Monthly: GeoNames and OSM; per election register: EC; nightly: pins.

---

## 11. Switching the model on: the six numbers (owner; no code)

Fees stay "confirmed by phone" until the launch wizard (`/admin/delivery/launch`) has its answers. Contract #4: this
spec does not invent them; the owner provides them from the riders' actual pay and the shop's costs.

| Wizard answer | Config key | What it means |
|---|---|---|
| A place riders go often, and the round-trip minutes | calibrates `speed`/`detour` prior | e.g. Ntinda, 50 minutes door to door and back |
| Rider pay per hour (or per trip) | `rider_cost_per_minute_ugx` | UGX |
| Handling minutes per order | `handling_minutes` | picking, packing, handover |
| Margin multiplier | `margin` | 1.0 = at cost |
| Minimum fee | `minimum_fee_ugx` | the floor |
| Furthest place a rider still goes | `own_rider_max_band` | beyond it → bus parcel / pickup |
| Free-delivery threshold (optional) | `free_delivery_threshold_ugx` | the waiver basis is already built |

With these set and Step 1 in place, Ntinda's quote is `max(min_fee, cost_per_minute × (handling + straight_km × 2 ×
detour / speed × 60 × factors + last_mile) × margin)`, rounded to `fee_rounding_step_ugx` (500), or placed on the
ladder (§4.5).

**A second way into the same six numbers, in the owner's language.** Riders in Kampala are paid per trip by
destination, not per minute, and the owner knows those prices without looking anything up. The wizard keeps its seven
questions and gains an alternative first screen: *"Three to five places you already send riders to: the place, what
the rider is paid for the trip, and roughly how long the round trip takes."* From those, `rider_cost_per_minute_ugx`
(pay ÷ minutes, median across the trips) and `effective_speed_kmh` (straight-line × 2 × detour ÷ hours) are derived
and shown with their working, exactly as the wizard shows its derivations today. Same six keys, same contract (#3),
one more path to them, and the reason the numbers have gone unset for months is removed: nobody has to think in
minutes.

---

## 12. Decisions for the owner

**Decide now (Week 0):**
1. **What the customer sees when distance becomes measured** (§4.1, §4.5): re-banding onto a price ladder the owner
   prices (recommended for the first month), re-banding with today's band fees, or a continuous fee per area. Every
   switch is reversible.
2. **The six launch numbers** (§11), by the seven questions or by trip prices. Nothing quotes without them.
3. **Targets for the success metrics** (§0): proposed, ≥90% of metro orders quoted by the model within a month of
   Step 1; a 28-day median |expected − actual| and a first-attempt success rate the owner sets once the baseline is
   read.

**Decide when the phase arrives:**
4. **Pin retention** (recommended 180 days), covering handover pins.
5. **Riders record handover on WhatsApp** (§5.2): accept that the delivery record is made at the door (a location
   message and two taps) rather than in the office afterwards, and that `rider_phone` is kept on the dispatch.
6. **Landmark step mandatory** for door delivery inside Kampala/Wakiso when no pin is given? (Recommended: yes for new
   customers; skipped for an address with a delivered pin on file.)
7. **A named owner for the yearly administrative review** (§7.4).
8. **Same-day eligibility by band** (B0–B3 before the cutoff) through the registry instead of the hard-coded
   Kampala/Wakiso list. Recommended: yes.
9. **A map for dragging a pin** (§13.3): self-hosted PMTiles (no key, no bill, more build), Google Dynamic Maps (free
   at our volume, key, off switch), or neither, because WhatsApp is the map. Recommended: neither until the data says
   pins are being refused for accuracy.
10. **Publish the OSM-derived landmark table openly** (simplest ODbL compliance).
11. **The pin nudge** (§4.6): once last-mile minutes per tier are learned, show the true saving for a pinned address.
    Recommended: yes, only when the learned difference is at least one rounding step.
12. **The ladder rungs** (§4.5): the owner's price points, entered in the Control Centre with a dry run. The model
    never proposes prices (contract #4); it proposes placements and raises the margin alarm.
13. **Dealer pickup points** (§4.6): whether dealers become collection options with their own fee from the same
    model. No code is needed to decide; `ug_pickup_point` is waiting for rows.

---

## 13. Providers, licensing, upgrades

### 13.1 Decision on providers
No paid API on the request path in Phases A–C. Area and landmark lookups come from our own tables; pins come from
WhatsApp, the device, pasted links and riders; distances are haversine × learned detour, later OSRM offline. Google
Places Autocomplete (session) + Place Details Essentials may be added in Phase D as enrichment when the registry
returns fewer than 3 results, behind `enrichment_provider='google'`: Google's terms forbid storing Places data beyond
30 days (place IDs excepted), so results are never written into `ug_landmark`, which is why the registry, not a
provider, is the system of record. Mapbox is not chosen (cheap tiles and routing at scale do not matter at our
volume; Kampala landmark coverage is weaker; temporary geocoding results may not be stored). Prices in Appendix G.

### 13.2 Licensing
- **OSM (ODbL):** OSM-derived rows stay identifiable (`source='osm'`, `source_ref`; area points with `source='parish_buildings'`
  are derived from OSM footprints and count too, with the extract date in `source_ref`) and in their own logical set;
  "© OpenStreetMap contributors" wherever they or OSM tiles are shown. Our own landmarks and pins in rows with
  `source ≠ 'osm'` make the whole a *collective* database; be prepared to publish the OSM-derived landmark table
  (not orders, not customers) on request (decision 10).
- **GeoNames:** CC BY 4.0, attribution in `/privacy` and the admin page. **HDX COD-AB:** CC BY-IGO, batch only.
  **UBOS 2016 parishes:** government statistical data redistributed inside a GPL-3 code repository; the GPL covers
  that repository's code, not the data; attribute "Uganda Bureau of Statistics, 2016 parish boundaries". **EC data:**
  public records; keep voter counts out of our database. **Passport-portal hierarchy packages:** MIT.
- **Customer and handover pins:** §5.7.

### 13.3 A map for dragging a pin (optional)
MapLibre GL + Protomaps PMTiles of Uganda served as one static file (~100–300 MB, no key, OSM attribution), or
Google Dynamic Maps inside the 10,000 free loads behind the enrichment switch. Leaflet + OSM's public tile servers
only on admin screens (OSMF usage policy).

### 13.4 PostGIS, when a trigger in OPERATIONS.md PART 7 fires
Switch the compose image to `postgis/postgis:16-3.4-alpine`, `CREATE EXTENSION postgis`, add `geography(Point,4326)`
columns generated from lat/lng, replace `earth_box` with `ST_DWithin`, ordering with `<->`, and the ray-casting
point-in-polygon with `ST_Contains` on a geometry built from `ring_wgs84`. Nothing in the API contract changes. Not in
Phase A: the 4 GB host and the rehearse-then-migrate deploy script are fine with contrib extensions at ≤100k points.

---

## 14. Rollout

**Week 0 — five cheap experiments before any architecture (two days, mostly queries).** Each one replaces an opinion
in §12 with a number: (a) read the baseline metrics from the capture table (free); (b) the owner sets the six numbers
by trip prices (fifteen minutes; §11); (c) run the parish import against a copy of the production gazetteer (the local database has no `ug_area` rows:
`data/locations/v1` is gitignored and lives on the server, so the first step is one owner command, `pg_dump -t
ug_area -t ug_area_alias -t delivery_corridor` from prod) and read the
three-list band report, which says how many bands are wrong *before* anything is written (one day); (d) count the
WhatsApp location messages Goldie has already received and dropped into text (`assistant_messages` where `role = 'user'` and `content like 'My location:%'`),
which is the pin rate the shop gets for free; (e) count orders whose `delivery_address` contains a landmark word
(near / opposite / behind / next to), which is the size of the landmark corpus. Decide 1–3 in §12 on those numbers.

**Phase A — points, the switches, the report (engineer ≈ 1 week; owner: the six numbers).** Create `geo_area_point`,
`geo_admin_polygon`, `ug_district`, `district_lineage`; accept unknown districts; run the parish import with
buildings; review the three-list band report in the Control Centre; wire `measuredKm`; add `distance_source`
(left at `band_midpoint`), `fee_shape` and `fee_ladder`; re-band through the corridor dry run; add the fee-step
counter; offline index gains points.
**Done when:** ≥95% of the 362 metro areas have a point with a non-null `expected_error_m` (89% is reachable by
exact name today); every band-report line has been looked at; quotes for ten named
test areas (Ntinda, Kabalagala, Najjera, Kajjansi, Kyengera, Kira, Bweyogerere, Nansana, Munyonyo, Mukono town)
return a fee from the model once the six numbers are in; `accuracy_tier` is written on every new capture.

**Phase B — pins that already exist, and the first landmarks (≈ 1–2 weeks).** WhatsApp location → order; the rider
handover link; saved addresses keep and receive pins; `hasPin` from checkout; mined order-text landmarks; the nightly
job; rider card additions. **Done when:** a WhatsApp pin sent after an order appears on that order's rider card
without anyone touching admin; a proposed ≥50% of metro deliveries in a two-week window have a handover pin (the owner sets the real figure); the first
`rider_handover` area points exist.

**Phase C — the landmark step and the registry (≈ 2 weeks).** OSM import; `GET /locations/landmarks`; the landmark
step with meeting points; Plus Code; EC names for GKMA; admin registry tab; district list from `ug_district`;
same-day by band. **Done when:** 60% of metro orders carry a landmark or a pin within two weeks of release, and every
GKMA parish in the EC list exists in `ug_area` or maps to one.

**Phase D — learn and refine (ongoing).** `distance_source = measured` when the owner is ready; OSRM road km
quarterly; calibration proposals driven by measured distance; optional Google enrichment; PostGIS only on a trigger;
the yearly drift report.

Each phase ships behind the Control Centre: config keys are drafts until published, and everything reverts in one
action (contract #9).

---

## 15. Pre-mortem: it is April 2027 and this did not work. Why?

Written before building, so each failure has an answer in the design rather than an apology after it.

| Likely failure | What in this spec answers it |
|---|---|
| The six numbers were never set; every quote still says "confirmed by phone" | Week 0 (b) and the trip-price path (§11). Nothing else in the document matters until this is done, and it is now a fifteen-minute task in the owner's own units |
| Fees changed and customers complained that Ntinda "used to be 8k" | Ladder first (§4.5), re-banding through a dry run, `distance_source` left at `band_midpoint` for the first month, every change reversible (§0b) |
| Riders never recorded handover | Route A needs no app, no page and no login: a location message and two taps on WhatsApp (§5.2). Partial coverage is still useful: customer pins, building centres and order text fill the rest. Route B exists if A fails |
| Customers did not share pins | Asked at the right moment (after the order, on WhatsApp, with the true saving once it is learned, §4.6); asked once per address because the saved address remembers (§5.4) |
| Polygon matching put wrong points on areas and the bands moved wrongly | The three-list report (§3.4) compares every new point with the band the team set by hand; nothing writes to a band without a person; lineage families stop cross-district matches (§7.2) |
| The nightly job drifted points on bad pins | Thresholds on count and spread, never overwrites `manual`, wide-spread areas listed for a person (§5.6); handover pins rejected more than 5 km from the area's point (§5.2) |
| A district was created and checkout broke, or data got stuck in the old list | Unknown districts accepted on the manual path (§7.1); districts as data with lineage (§7.2); the yearly drift report with a named owner (§7.4) |
| A maps bill arrived | No paid API on the request path; enrichment off by default; counts sized against the free tiers (§13, Appendix G) |
| A privacy complaint about stored locations | Retention window, aggregate points only, a rider sees one stop's pin for 48 h (§5.7) |
| Nobody could say whether it worked | The baseline was read in Week 0 (a) from columns that already exist, and the same four numbers are in the Control Centre (§0) |
| The spec was too big and nobody read past §3 | §0 is one page and is the whole plan; everything after §2 is reference for the step being built |

---

## Appendix A — Data sources, with what was measured (2026-10-15)

"GKMA box" = lat −0.05…0.60, lon 32.30…32.95 (Kampala, Wakiso, Mukono town, Entebbe, Mpigi town).

**A.1 Ministry of ICT draft postcodes, April 2019 (imported; the key space).** 5,805 areas, 135 districts, parish/area,
sub-county/division, county, region; no coordinates. The owner supplied the source tables (also at techjaja.com,
2020); scheme and defects in Appendix B. The `area_slug` carries the postcode and is the join spine to every other
source: 2019 parish ↔ 2016 polygon ↔ EC parish ↔ GeoNames ADM5 ↔ passport-portal parish.

**A.2 GeoNames `UG.zip` (0.7 MB, CC BY 4.0).** 26,943 features; 11,455 PPL, 2,215 ADM5, 1,359 ADM4, 1,270 SCH, 642
HSPC, 78 HSP, 88 missions. In the box: 1,205 PPL, 118 ADM5, 44 ADM4, 27 HSPC, 12 HSP, 9 SCH. Kampala PPL sample:
Bakuli, Bugolobi, Bukoto, Bunga, Butabika, Bwaise, Bweyogerere, Ggaba, Kabowa, Kansanga, Katwe, Kawempe, Kazo, Kibuye,
Kikaaya, Kinawataka (160 places); ADM5 sample: Bwaise I, Kabalagala, Kanyanya, Kawempe II, Kibuli, Kireka, Kyaliwajala,
Kyanja, Makerere III, Mulago II, Mutundwe, Naguru Godown, Najjanankumbi II, Ndeeba, Wabigalo. Points are settlement
labels, 200 m–1 km typical; gap fill only.

**A.3 OpenStreetMap (ODbL).** Overpass mirrors that answered: `overpass.kumi.systems`, `overpass.private.coffee`,
`maps.mail.ru/osm/tools/overpass` (`overpass-api.de` unreachable). Counts in the box: amenity=school 2,430 (n2038 w391
r1); place_of_worship 622; bank 461; pharmacy 424; shop=supermarket 409; police 158; marketplace 143; place=neighbourhood
96; highway=bus_stop 88; amenity=taxi 82 (75 nodes, 7 ways); place=suburb 78; bus_station 58; named highways 4,148 ways;
building=* 1,567,904 ways; Uganda-wide boundary relations admin_level 4: 146, admin_level 9: 51 (parish/village
boundaries mostly absent). hospital, clinic, fuel, mall, village, hamlet: mirrors timed out; count from the Geofabrik
extract. Bulk: `download.geofabrik.de/africa/uganda-latest.osm.pbf` with `osmium` (not installed on the Mac yet).

**A.4 Electoral Commission polling stations (Kalulu repo `Uganda-Open-Data/kalulu`, updated 2026-05-01).**
`voter_register_summary_2020.csv`: 34,684 stations; district, constituency, sub-county, parish, station, voters;
**no coordinates** (the research note assumed otherwise). GKMA: Kampala 1,423 stations / 6 divisions / 98 parishes;
Wakiso 1,434 / 27 / 147; Mukono 619 / 18 / 97; Mpigi 245 / 9 / 56. Names like "MATHEL NURSERY SCHOOL (NAMUI-S)",
"KAWEMPE MBOGO MUSLIM S.S.S. (A-K)", "JAMBULA [NABI-Z]- LC I OFFICE".

**A.5 HDX COD-AB `cod-ab-uga` (UBOS with WHO, reviewed 2026-09-21, CC BY-IGO).** GeoJSON 37 MB, SHP 33 MB, GDB 16 MB.
Admin 1 = 4 regions, Admin 2 = 135 districts, Admin 3 = 203, Admin 4 = 1,520 sub-county polygons (2020). **No parish
or village polygons** (the research note assumed otherwise).

**A.6 Delivered pins (own data).** `addresses.gps_*`, `orders.delivery_location.gps*`, the capture row. Nothing
aggregates them today; §5.6.

**A.7 Plus Codes.** 14 m × 14 m at 10 characters (`6GCRPR6C+24` central Kampala). npm `open-location-code` 1.0.3 or
`pluscodes` 3.0.1. Offline encode/decode.

**A.8 Not used, and why.** KCCA street naming / house numbering: begun 2017, GPS survey under KIIDP-2 (2024), no
public dataset, revisit yearly. DataHub "postal-codes-ug": GeoNames PPL with empty postcode fields. Public Nominatim
for bulk: forbidden by its usage policy (1 req/s, no bulk); self-hosted Photon/Nominatim possible later, not needed.
Boda stages: 82 in OSM for the whole box; they will come from riders and customers, not the map.

**A.9 UBOS 2016 parish polygons (owner-supplied: `uganda-APIs` repo → `GIS-Parishes-2016.zip` 28 MB →
`Ug_Parishes_2016.shp`).** 7,566 polygons, 116 districts; fields OBJECTID, D, C, S, P, V (reference village), PCODE,
Shape_Leng, Shape_Area; projection Arc 1960 / UTM 36S (EPSG:21036), datum shift to WGS84 EPSG:1122 (dX −160, dY −6, dZ
−302 m). GKMA: Kampala 96, Wakiso 151, Mukono 80, Mpigi 56 parishes (357 in the box; median 9.7 km², Kampala median
1.2 km²). Centroids computed by hand on 2026-10-15 (no pyproj wheel for Python 3.14): `~/Downloads/
ug_parishes_2016_centroids_wgs84.csv` (7,566 rows), verified against Civic Centre 0.3127, 32.5860; Kabalagala 0.3011,
32.5992; Ntinda 0.3467, 32.6181; Bugolobi 0.3112, 32.6227. Name agreement with the EC 2020 parish list before folding:
Kampala 82/98 (83%), Wakiso 121/144 (84%), Mukono 65/95 (68%), Mpigi 46/56 (82%). Against the shop's metro index
(390 entries) by exact folded name: 350 (89%); the Kampala misses are NAKAWA INSTITUTION, KIKAAYA, NAJJANANKUBI I/II,
NATETE, BUGOLOBI, CIVIC CENTER, LUBYA, NANKULABYE, NTINDA POLICE BARRACKS, NAKIVUBO-SHAURIYAKO, NSAMBYA ESTATE,
MAKERERE UNIVERSITY, all spelling variants of index entries.

**A.10 Passport-portal hierarchy (owner-supplied: `locations-uganda` npm, `uganda-geo-data` PHP, `ug-locale` Laravel;
MIT).** The same scrape three ways: 135 districts → 303 counties → 2,120 sub-counties → 10,365 parishes → 71,250
villages; names and parent ids only, villages upper-case. The deepest open gazetteer; what a customer in Wakiso says
("Kira, Bulindo").

**A.11 EC 2025/26 electoral structure (owner-supplied: `uganda-location-selector` npm, MIT).** 222 electoral districts
(cities and municipalities counted separately), 427 constituencies, 1,881 sub-counties, 3,454 electoral areas, with
EC codes that join to the Kalulu station codes, so the 2026 register can be loaded without re-matching names.

**A.12 Owner-supplied files not adopted.** `Uganda-Delivery-Cost-API` (a FastAPI toy: 20 district centroids × weight ×
"risk factor"; contract #4 forbids invented multipliers); `uganda-APIs/districts_large_map.json` (139 sub-parishes
filled, the rest empty); `final-vote-by-district-2016-presidential.csv` (112 districts, vote counts, no location use).

## Appendix B — The 2019 postcode scheme and its defects

Five digits: zone (1 Kampala, 2 Eastern, 3 Central, 4 Western, 5 Mid-Western, 6 West Nile, 7 Northern, 8
North-East), two-digit district number (Kampala `1` + division `01`–`05`; Wakiso spans `313`/`314`, Arua `604`/`605`,
Kasese `503`/`504`, Bulambuli `821`/`822`), two digits per parish or ward in the Ministry's order. 128 district blocks;
Kampala 96 parishes (Central 20, Kawempe 19, Nakawa 23, Makindye 21, Rubaga 13). The 2019 list still has Kazo under
Kiruhura, Madi-Okollo under Arua, Kitagwenda under Kamwenge, Kalaki under Kaberamaido, Obongi under Moyo, Rwampara
under Mbarara. A customer never types a postcode (brief PART B).

Defects in the source tables (handled by the importer's exceptions file; no join may assume the list is clean):
duplicate codes Kyengera 31440, Kyotera 32008/32027/32029, Kasese 50382, Gomba 32617/32619, Luuka 22106, Bulambuli
82101/82102 ("Butta Ward" twice), Sironko 21059 (the brief counts 14); truncated or out-of-sequence codes (Sironko
"Shimoma 2103", "Busedani 21059"); Kiryandongo row 13 without a parish name; names printed without spaces
(NakivuboShauliyako, OldBomaWard, LakeMburo, QueenElizabeth, St.AloysiusPtcCompl); spellings that differ from UBOS and
the EC (Bogolobi, Lubia, Kikaya, Najjanankumbi, Kazo Ward); Wakiso omits 31401–31404; institutions and land listed as
parishes (University (Makerere), Luzira Prisons, Nsambya Police Barracks, Nakawa Institutions, Army Barracks (Mpigi),
Mt. Elgon, Queen Elizabeth, Rwenzori Mountain, Hunting Area, Grazing Area, Lake Mburo, Bwindi Impenetrable, Semuliki,
Kyangwali Gr) → `area_kind` (§3.3).

## Appendix C — OSM extraction

Offline, preferred (no limits; needs `osmium`, not yet installed on the Mac):
```
osmium extract -b 32.30,-0.05,32.95,0.60 uganda-latest.osm.pbf -o gkma.osm.pbf
osmium tags-filter gkma.osm.pbf w/building -o gkma-buildings.osm.pbf
osmium export gkma-buildings.osm.pbf -f geojsonseq -o gkma-buildings.geojsonl      # footprint polygons → centroid in the importer
osmium tags-filter gkma.osm.pbf nwr/amenity=school,hospital,clinic,place_of_worship,taxi,fuel,bank,marketplace,police,pharmacy nwr/shop=mall,supermarket nwr/place=suburb,neighbourhood,village,hamlet,locality -o gkma-pois.osm.pbf
osmium export gkma-pois.osm.pbf -f geojsonseq -o gkma-pois.geojsonl
```
Overpass fallback, one tag per request, `out center;` gives a point for ways and relations:
```
[out:json][timeout:180];
( node["amenity"="school"](-0.05,32.30,0.60,32.95);
  way["amenity"="school"](-0.05,32.30,0.60,32.95);
  relation["amenity"="school"](-0.05,32.30,0.60,32.95); );
out center tags;
```
Etiquette: identify with a `User-Agent`, one request at a time, ≥10 s apart, retry across mirrors.

## Appendix D — GeoNames `UG.txt` columns used
`geonameid(1) name(2) asciiname(3) alternatenames(4) latitude(5) longitude(6) feature_class(7) feature_code(8)
country(9) admin1(11) admin2(12) population(15) modification_date(19)`. admin1 C/E/N/W = Central/Eastern/Northern/
Western; admin2 = district name (matched inside the lineage family). Codes: PPL, PPLX, PPLL, ADM4, ADM5, SCH, HSP,
HSPC, CH, MSQE, MKT.

## Appendix E — EC station name normalisation
| Raw | Normalised | Category |
|---|---|---|
| `MATHEL NURSERY SCHOOL (NAMUI-S)` | Mathel Nursery School | school |
| `KAWEMPE MBOGO MUSLIM S.S.S. (A-K)` | Kawempe Mbogo Muslim Secondary School | school |
| `KISIMBIRI B [NAT -Z] KISIMBIRI C/U P/S` | Kisimbiri Church of Uganda Primary School | school |
| `JAMBULA [NABI-Z]- LC I OFFICE` | Jambula LC1 Office | office |
| `UCTU GROUND (A-L)` | UCTU Ground | other |
Remove `\(.*?\)` and `\[.*?\]` voter ranges; expand `P/S`, `P.S`, `S.S.S`, `S.S`, `C/U`, `R/C`, `S.D.A`, `H/C`
(health centre), `T/C` (trading centre), `LC I` → `LC1`; collapse spaces; title-case except acronyms; one station
name appears 2–4 times split by voter range, dedupe.

## Appendix F — Bands, accuracy tiers, and what the rider gets

Band edges (MODEL.md): B0 0–2 km (midpoint 1.0), B1 2–5 (3.5), B2 5–9 (7.0), B3 9–15 (12.0), B4 15–25 (20.0), B5
25–45 (35.0), B6 45–70 (57.5). The midpoint error is up to ±5 km in B4 and ±12.5 km in B6, doubled for the round trip.

| Tier | Customer gave | Rider card shows | Distance used |
|---|---|---|---|
| PIN | device ≤100 m, pasted link, Plus Code, WhatsApp location, saved address with a delivered pin | map link, Plus Code, landmark if any, directions | haversine from hub × detour (road km when routed) |
| LANDMARK | a registry landmark (hint or meeting point) | landmark + category, "meet at" when chosen, map link, directions | distance to the landmark point |
| AREA_POINT | area only | area, directions, "call before dispatch" if no directions | `geo_area_point` (source and expected error shown to ops) |
| BAND_MIDPOINT | area without a point yet | as today | band midpoint |
| DISTRICT | manual path, or an unverified district | as today | none; manual queue |

## Appendix G — Provider list prices (2026-10-15, per 1,000 after the monthly free amount)

Sizing assumption: 1,000 checkouts/month, 3 quote calls each, 1 map load each, 300 pins. Everything below stays
inside the free amounts at that volume.

Google Maps Platform (Essentials unless stated): Autocomplete 10,000 free then $2.83 (session billing: the session is
free, the closing Place Details call is billed); Place Details Essentials/Pro/Enterprise 10,000/5,000/1,000 free then
$5.00/$17.00/$20.00; Geocoding 10,000 then $5.00; Address Validation (Pro) 5,000 then $17.00; Dynamic Maps 10,000 then
$7.00; Static Maps 10,000 then $2.00; Compute Routes Essentials/Pro/Enterprise 10,000/5,000/1,000 then
$5.00/$10.00/$15.00; Compute Route Matrix (per element) 10,000 then $5.00; Distance Matrix (legacy) 10,000 then $5.00.
Best Kampala landmark coverage of any provider; Places data may not be stored beyond 30 days except place IDs.

Mapbox: Geocoding temporary 100,000 free then $0.75 (100k–500k), permanent (storable) none free, $5.00; Search Box
(session) 2,500 then $11.50; Directions 100,000 then $2.00; Matrix (per element) 100,000 then $2.00; GL JS map loads
50,000 then $5.00; Static Images 50,000 then $1.00. Temporary geocoding results may not be stored.

Free / self-hosted: MapLibre GL + Protomaps PMTiles of Uganda (one static file, ~100–300 MB, no key, OSM attribution);
Leaflet + OSM public tiles (admin screens only, OSMF policy); Photon/Nominatim on the Uganda extract (~2 GB RAM, not
needed); OSRM offline on the Mac (no runtime service).

## Appendix H — Sources
- Research note: "Strategic Geospatial Architecture and Last-Mile Logistics Optimization for E-Commerce Delivery in
  Uganda" (owner-supplied, 2026). Its three data claims that do not hold: EC stations have no coordinates; HDX COD-AB
  has no parish polygons; boda stages are barely in OSM.
- Owner-supplied datasets (2026-10-15): Ministry of ICT 2019 postcode tables (also techjaja.com 2020); `uganda-APIs`
  repo with the UBOS `Ug_Parishes_2016` shapefile; `locations-uganda`, `uganda-geo-data`, `ug-locale`;
  `uganda-location-selector`; Kalulu election data.
- District count: Electoral Commission statistics ahead of the 2026 election (Daily Monitor, 2025): 146 districts and
  cities, from 135 in 2021; April 2025 approval of three districts and Tororo City (Pulse Uganda). The Gazette is the
  source of record for effective dates.
- HDX `cod-ab-uga` metadata (CKAN, 2026-09-24 resources); GeoNames `UG.zip` (2026-10-15); Kalulu file list and
  `voter_register_summary_2020.csv` (2026-10-15); Overpass counts (2026-10-15, mirrors as noted).
- Google Maps Platform pricing (page dated 2026-10-14); Mapbox pricing (2026-10-15); Nominatim usage policy.
- KCCA road naming and house numbering guidelines (2017); The Independent on the KIIDP-2 addressing survey (2024).
- Code read on 2026-10-15: `WhatsAppGoldie.ts`, `schema/delivery.ts`, `schema/fulfilment.ts`, `schema/locations.ts`,
  `DeliveryUseCases.ts`, `DeliveryCaptureUseCases.ts`, `MODEL.md`, `CONTRACT.md`, `uganda.ts`.

## Appendix I — What changed from version 1, and why (the self-critique, in one place)

1. **The order of work was upside down.** V1 led with a data catalogue; the six owner-set numbers that gate every
   quote were §10. V2 opens with the ranked causes, the metric, and a five-step critical path.
2. **No success metric.** V1 never said how anyone would know it worked. V2 uses the capture columns that already
   exist (`expected_minutes` vs `actual_minutes`, model-quoted share).
3. **Invented confidences** (0.95, 0.75, 0.60…) broke contract #4. V2 ranks sources explicitly and stores an expected
   error in metres only where it is measured or stated.
4. **OSRM was on the critical path, and detour was double-counted.** MODEL.md already prices straight-line × learned
   detour when a centroid exists; v1's §9 then fed road km into a formula that still multiplied by detour. V2: no
   router in Phase A; `distance_source` switch; road km in Phase D with detour 1.0.
5. **Duplicate columns.** V1 added `road_km` to a capture that already has `straight_line_km`, `centroid_source`,
   `actual_minutes`. V2 writes the existing columns.
6. **The pin channels that already exist were ignored.** Goldie parses WhatsApp location messages today and drops
   them into text; riders stand at the door with a phone; the delivery record is typed in the office afterwards. V2
   routes WhatsApp pins to the order, adds the one-tap handover link, and makes the saved address remember its pin,
   before any map widget. Decision "which map" became "probably none".
7. **Landmarks came from OSM first.** The shop's own order text holds the landmarks its customers actually use, and
   `ug_search_miss` already records what customers typed that we did not know. V2 mines both first (no licence, no
   download), OSM second, EC names third. Meeting points ("meet me here") were missing entirely.
8. **Geometric centroids are the wrong point.** 1.57 million OSM building footprints are in the box; the centre of a
   parish's buildings is where its deliveries go. V2 uses it, with the measured spread as the error.
9. **New data was not checked against old.** The hand-assigned bands are a validator for every matched polygon; v1
   never used them. V2's three-list report does.
10. **Districts.** V1 matched "within the same district" across datasets that use five different district lists
    (116 / 128 / 135 / 146 / 222) and left the API rejecting unknown districts. V2: lineage families, districts as
    data with a dated lineage, unknown districts accepted on the manual path (contract #8), additive boundary sets,
    opaque slugs, a yearly drift report with a named owner; **146 districts and cities (EC 2025)** is the one count.
11. **Institutions as parishes.** The postcode tables list prisons, barracks, a university, national parks and
    mountains as parishes; v1 would have priced them as homes. `area_kind` fixes it.
12. **`earthdistance` needs a superuser** (verified; `cube` does not). The no-extension fallback is written.
13. **Fee presentation was never a decision.** Continuous per-area fees and "fix the wrong bands" use the same data
    and look very different to a customer. V2 makes it the first owner decision and recommends re-banding first.
14. **Drafting history was in the body** (a §2 numbered 1, 2, 4, 3; "the thing my first draft got wrong" in §3). It
    is here instead.

Version 2.1, same day, after asking "what would make this fail, what does the model already allow, and what do
customers and riders already do":
15. **The spec never said what it would not touch.** §0b lists it and states the additive-only rule.
16. **One metric was too few.** First-attempt success is the hidden cost better locations fix first; fee-step
    abandonment was not measured at all. §0 has four.
17. **Pricing was tied to names that change.** Learned scopes on geohash cells survive every boundary change and
    need no schema (§4.4).
18. **"Re-banded" was wrongly a distance source**, and the customer-facing shape of the fee was never designed.
    `fee_shape` with a ladder the owner prices and the model places, plus a margin alarm (§4.5).
19. **The pin discount was waiting in MODEL.md** (`last_mile_minutes(area, has_pin, …)`, "justifies the pin nudge").
    §4.6 lets it, meeting points, pickup and dealer collection fall out of learned last-mile minutes per tier
    instead of being invented. Batching named as the reason per-order cost will undercut quotes.
20. **The rider link was more UI than needed.** A WhatsApp location message and two button taps do the same job on
    the parser that exists; the link page is the fallback (§5.2). "Hard to find" is one more tap and a measured
    area-difficulty signal.
21. **The six numbers were asked for in minutes.** Riders are paid per trip; the owner knows trip prices. §11 adds
    the trip-price path to the same six keys.
22. **Nothing cheap came before the architecture.** Week 0 is five queries and a fifteen-minute owner task that turn
    the three "decide now" questions into numbers (§14).
23. **No pre-mortem.** §15.

Version 2.2, same day, a consistency pass against the code and across the three revisions:
24. **`straight_km_hub` cached one origin's distance on the area** while `delivery_origin` allows several. Distance
    is computed at quote time; the column is gone.
25. **§3.2 conflated 357 polygons in the box with 350 matched entries.** Corrected.
26. **The band report compared straight-line km with bands that may have been assigned by road feel.** It now shows
    a 1.3 detour allowance (a report parameter) and lists fulfilment-mode flips past `own_rider_max_band`, which
    matter more to a customer than a fee change.
27. **Config keys cited from memory were wrong or incomplete:** `rider_cost_per_minute_ugx`, the registry's real path
    (`domain/delivery/`), and `copy_pin_nudge`, which already exists for exactly the nudge in §4.6. The calibration
    use case exists but no timer for it is in the repo; it has to be confirmed on the host.
28. **The quote cache key is area + basket + config version**, so a pinned quote would have been served from the
    area's cache. The key gains the pin cell or landmark id.
29. **Week 0 (c) assumed a local gazetteer.** The local database has no `ug_area` rows (the CSVs are gitignored and
    on the server); the dump is the first step. Week 0 (d) is now a concrete query on `assistant_messages`.
30. **No build rules.** No dependency list, migration number, test list, Mac tooling or disk note existed (§9b).
    OSM-derived area points were outside the ODbL note; WhatsApp template review and the 24-hour window were
    unmentioned; rider phone numbers were outside the privacy section; pins were checked against a district
    "family" instead of the area's point; the 20-building and 50%-handover figures were unlabelled guesses and are now
    a registry key and a proposal.
