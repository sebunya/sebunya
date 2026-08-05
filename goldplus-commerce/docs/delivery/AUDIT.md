# Delivery Estimation — PART 2 audit (stage 1)

Date: 2026-08-05 · No code written. Implementation is held until this is
approved.

---

## 1. Origin verification — the conversion is wrong, and I can name how

| | Latitude | Longitude |
|---|---|---|
| Supplied DMS | 0° 18' 48" N | 32° 34' 39" E |
| Correct decimal | **0.31333** | **32.57750** |
| Supplied decimal | 0.3133 ✅ | 0.5775 ❌ |

`34/60 + 39/3600 = 0.57750` **exactly**. The whole-degrees component (32) was
dropped during conversion — this is not a typo or a rounding artefact, it is a
reproducible conversion error, which means it will recur unless a test pins it.

Bounding-box check (lat −1.5…4.3, lng 29.5…35.1):

- correct pair (0.31333, 32.57750) → **inside Uganda** ✅
- supplied pair (0.3133, 0.5775) → **outside** (Gulf of Guinea, ~3,600 km away)
- zero origin (0, 0) → **outside** — so the same test catches the missing-origin-row
  failure mode for free

`goldplus_delivery_origins.csv` already carries the corrected pair, with
`coord_source=operator_supplied_dms_converted` and
`coord_confidence=approximate_adjacent_landmark`. Both landmarks are present in
the right order: `landmark_primary` = Uhuru Restaurant,
`landmark_secondary` = Pioneer Mall parking.

**Action at build time:** the bounding-box test, and a note that
`coord_source` must become `onsite_capture` before go-live.

---

## 2. The baseline — the number every later claim is measured against

### 2.1 What exists

**Two fee paths exist today, not one.** This is the PART 1 #1 consolidation
target, and it is worth being precise about which is which:

| Component | What it does | Source of truth |
|---|---|---|
| `domain/commerce/DeliveryFee.ts` → `resolveDeliveryFee` | Per-**district** configured zone fee. No zone → 0 UGX, `confirmed=false` | `delivery_zones` table |
| `domain/commerce/DeliveryFeePrediction.ts` → `estimateDeliveryFee` | 8-band step function over road-km-from-Kampala, precedence **ZONE > OBSERVED median (n≥2) > MODEL band** | `UGANDA_DISTRICT_ROAD_KM` + order book |
| `domain/locations/DeliveryZonePolicy.ts` | Z1–Z4 SLA / COD / carrier. **Deliberately owns no fees** (location-module Decision 7, "Option A") | `delivery_zone_policy` table |

Relationship to the location module's Decision 7 fee owner: Decision 7 put fee
ownership with `delivery_zones` + the band model and kept `delivery_zone_policy`
fee-free on purpose. That holds — the policy table has never carried a fee.
So the consolidation is **two into one**, not three.

Its band edges (CORE ≤6km, CITY ≤12, METRO ≤25, METRO_EDGE ≤45, NEAR ≤160,
MID ≤340, FAR ≤520, REMOTE ∞) are a **different scheme** from the new B0–B6
(0–2, 2–5, 5–9, 9–15, 15–25, 25–45, 45–70 km). They are not reconcilable by
renaming; B0–B6 replaces them.

### 2.2 Replay of all 18 historical orders

| Order | Stored district | Resolves? | km | Band | Would have quoted |
|---|---|---|---|---|---|
| GP-202605-F1DC | Kampala | ✅ | 0 | CORE | 5,000 (MODEL) |
| GP-202605-4786 | Kampala | ✅ | 0 | CORE | 5,000 (MODEL) |
| GP-202605-4D9B | Kololo Ii | ❌ | — | — | **UNAVAILABLE** |
| GP-202605-58E6 | Kololo Ii | ❌ | — | — | **UNAVAILABLE** |
| GP-202605-022F | Old Kampala | ❌ | — | — | **UNAVAILABLE** |
| GP-202605-E463 | Kansanga-muyenga | ❌ | — | — | **UNAVAILABLE** |
| GP-202605-EF07 | Kansanga-muyenga | ❌ | — | — | **UNAVAILABLE** |
| GP-202605-CB83 | Kagugube | ❌ | — | — | **UNAVAILABLE** |
| GP-202605-50CD | Kagugube | ❌ | — | — | **UNAVAILABLE** |
| GP-202605-2A8C | Esia | ❌ | — | — | **UNAVAILABLE** |
| GP-202605-AC7B | Atunga | ❌ | — | — | **UNAVAILABLE** |
| GP-202605-A920 | Bukesa | ❌ | — | — | **UNAVAILABLE** |
| GP-202605-1941 | Lazebu | ❌ | — | — | **UNAVAILABLE** |
| GP-202608-3935 | Kampala | ✅ | 0 | CORE | 5,000 (MODEL) |
| GP-202608-C4BC | Kampala | ✅ | 0 | CORE | 5,000 (MODEL) |
| GP-202608-DBF2 | Mukono | ✅ | 25 | METRO | 12,000 (MODEL) |
| GP-202608-19D9 | Kampala | ✅ | 0 | CORE | 5,000 (MODEL) |
| GP-202608-AAAB | Wakiso | ✅ | 15 | METRO | 12,000 (MODEL) |

**Baseline: 7 of 18 priced (39%). 11 of 18 UNAVAILABLE (61%).**

Every one of the 11 failures has the **same root cause**: an AREA name is
stored in the district field (Kololo, Old Kampala, Kagugube, Bukesa, Kansanga-
Muyenga, Esia, Atunga, Lazebu), so `normalizeUgandaDistrict` returns null → no
km → no quote. The location module's area resolution fixes exactly this class,
which means the new engine's coverage gain is largely already earned.

Note GP-202608-DBF2: priced at Mukono/25km, but the E.4 migration proved the
destination is **Kira, Wakiso** (15 km). Same band here so the same fee, but
the input was wrong — this is precisely the `AREA_MISMATCH_ON_RESOLUTION`
variance class from PART 5.

### 2.3 Error against actuals — cannot be computed, and this must be said plainly

| Measure | Available? |
|---|---|
| Actual fee charged | **No.** All 18 orders: `delivery_fee = 0`, `delivery_fee_confirmed = false` |
| Actual delivery time | **No.** No order has ever reached `dispatched` or `delivered`. `order_events` holds only received / pending_payment / cancelled |
| Actual rider cost | **No.** No such field exists anywhere in the schema |

**There is no error to report, because there is nothing to compare against.**
The baseline is therefore a *coverage* baseline (39% priced), not an *accuracy*
baseline. Accuracy measurement begins with the first delivered order. Any later
claim of "the model improved" must be honest that it starts from zero
observations, not from a measured error.

---

## 3. Everything else PART 2.3 asked for

**GPS pins on saved addresses:** `addresses` has 2 rows, **0 with a GPS pin**.
The pin columns exist (0084) and the picker captures them; nothing has used
them yet. Centroid precedence #1 in MODEL 3.5 has no data to work from today.

**Order lifecycle timestamps:** the states exist — `dispatched`, `delivered`,
`delivery_failed` were added to the state machine in the location-module stage-2
work, with `OrderTransitionService` writing every hop to `order_events`, and
`RecordDeliveryUseCase` populating `fulfilment_deliveries`. **The machinery is
real and unused:** `fulfilment_deliveries` = 0 rows, and no order has reached a
delivery state. `orders` itself has no `dispatched_at` / `delivered_at` columns —
timestamps live in `order_events`, which is queryable but not indexed for the
per-delivery capture PART 4 needs.

**Rider cost:** not recorded per order or per run. Nothing to build on;
PART 4's `actual rider cost` is a new capture.

**Fee change on a placed order:** **no path exists.** No admin route, no ops
route, no rider route mutates `delivery_fee` after placement. This is a clean
slate: PART 5 variance is new construction, and there is no unaudited legacy
path to close first. (It also means requirement #16 — "a placed fee cannot
change for a reason outside the list" — is currently true vacuously, and must
stay true once the variance path is added.)

**Time zone:** **nothing handles East Africa Time anywhere in the codebase.**
No `Africa/Kampala`, no offset handling. Everything is UTC or local-server. The
cutoff countdown (PART 9 #21) is new work with no foundation, and this is the
single most likely source of a promise broken daily.

**Free delivery threshold:** `free_delivery_threshold_ugx` exists on
`delivery_zone_policy`, is editable in the admin locations page — and is **read
by no quote path at all.** It is an inert field. Its ordering against
promotions and loyalty redemption is therefore currently *undefined*, not
merely undocumented. For reference, checkout today applies promotions during
quoting and loyalty redemption after (the discount lands inside order totals
with a repository guard). Delivery fee is added outside both. The three
orderings PART 9 #22 requires must be specified, not discovered.

---

## 4. The four data files

| File | Rows | Expected | Status |
|---|---|---|---|
| `goldplus_delivery_origins.csv` | 1 | 1 | ✅ present, corrected coordinate |
| `goldplus_delivery_corridors.csv` | 362 | 362 | ✅ present |
| `goldplus_alias_corridors.csv` | 28 | 28 | ✅ present |
| `uganda_name_collisions.csv` | — | 84 | ❌ **NOT SUPPLIED** |

Cross-checks against the live gazetteer:

- All **362** corridor `area_slug`s resolve into `ug_area`, and the set is
  **exactly** the 362 metro areas already imported. No orphans, no gaps
- All **28** alias anchors resolve. **5 aliases carry a band that differs from
  their anchor** (`differs_from_anchor=YES`) — so the alias table is not
  redundant and must be imported as its own layer, not derived
- **0** rows are missing a corridor or a band
- 14 corridors: cbd 13, kira_rd 22, rubaga_rd 5, bombo_rd 38, gayaza_rd 22,
  jinja_rd 69, port_bell_rd 8, makindye_rd 14, entebbe_rd 36, ggaba_rd 5,
  masaka_rd 73, hoima_rd 42, mityana_rd 3, lake_victoria 12
- Bands: B0 13, B1 29, B2 42, B3 30, B4 54, B5 104, B6 90
- Access: road 350, **water 12** ✅ matching the brief

**Discrepancy in the brief worth correcting:** PART 8 says bands were assigned
"200 rows at area level and 162 inherited from sub-county". The file says
`assignment_basis`: area_level **182**, sub_county_level **180**. The 200/162
split is `assignment_confidence`: high 200, medium 162. Two different columns.
I will follow the file.

**The 12 water areas**, for the Ntenjeru verification the brief asks for:

- *Ntenjeru, Mukono* (needs checking — may be road-reachable): Ssaayi, Mpatta,
  Kabanga, Mpunge
- *Koome Islands, Mukono* (confidently water): Bugombe, Mubembe, Lwomolo,
  Busanga
- *Kasanje, Wakiso* (confidently water): Bussi, Zzinba, Zzinga
- *Buwama, Mpigi* (confidently water): Bunjako

Note **Busanga** here is the Koome Islands one — the same name that the
location module's negative trap keeps away from "Bunga". Unrelated places,
worth knowing when reading collision output.

---

## 5. The plan, against PART 7

Twelve phase-1 items, grouped into five stages that each end green and
deployable. Nothing here is built until this plan is approved.

### Stage A — foundation and the things that must be true first
*(PART 7 items 1, 2; guardrails from PART 8)*

- Origin bounding-box test, and the missing-origin case proven by the same test
- Retire `goldplus_locations_seed.sql` so it **cannot execute** (PART 9 #13) —
  a guard test, not just deletion
- Schema: origins, corridors, alias corridors, collisions, the config registry
  and its versioning, the calibration capture table
- Import all four files, MD5-gated in the same shape as the gazetteer import,
  with row-count assertions 1 / 362 / 28 / 84 and a proven no-op re-run
- Required-field guard: no metro area and no active alias without a corridor
  and band (#9)

**Blocked on:** `uganda_name_collisions.csv`.

### Stage B — the one model
*(PART 7 items 3, 4)*

- The single expected-minutes equation, in the domain, pure and tested
- One shrinkage formula applied to every learned value, no special cases
- All learned factors ship at 1.0 with sample size carried alongside
- Fee and window from the same number, structurally incapable of disagreeing —
  the test asserts they derive from one call
- Every refusal in MODEL 3.6, each with its own test: non-metro, unserviceable,
  the 12 water areas, no active origin, missing corridor/band
- The six launch values, `fee_unavailable` until all six are set

### Stage C — commitment and customer surface
*(PART 7 items 5, 6, 7, 8)*

- Quote caching so one basket has one fee at product, cart and checkout
- The free-delivery ordering rule — **specified first, then implemented**, all
  three orderings tested
- The three disclaimer stages, all editable, all with preview
- Variance: the five reason codes, absorption threshold, agreement-before-
  dispatch, full audit row, and a test that *tries* to change a fee for a
  reason outside the list and fails
- Rider card COD immutability
- Name collision handling, a test per class
- Cutoff countdown in East Africa Time — including a day boundary and a
  weekend, which is where this breaks
- Pickup shown alongside every quote, both landmarks, Uhuru first

### Stage D — learning
*(PART 7 items 9, 10)*

- Capture layer for every field PART 4 lists
- Nightly jobs that **propose, never apply**
- Variance and margin reports
- Self-tuning window against the on-time target

### Stage E — Control Centre and rollout
*(PART 7 items 11, 12)*

- The registry, the generated UI, `CONFIGURATION.md` generated from it
- Draft → mandatory preview against real orders → publish → revert
- Three tiers, maker-checker on Tier 2, no Tier 3 value in the UI
- CSV round trip with dry run
- Shadow mode, comparison against the 39% baseline above, staged per-area
  cutover, one-command revert
- End state: **exactly one quoting service**; the two paths in §2.1 become its
  internals

### Sequencing note

Stage C's variance work depends on Stage B's quote existing, and Stage D
depends on C's capture points. Stage E can start in parallel with D once the
registry shape is fixed in B. The only hard external dependency is the missing
collisions file, which blocks part of Stage A and all of the collision tests in
Stage C.

---

## 6. Stage A — complete (2026-08-05, migrations 0092)

**East Africa Time**, built as a primitive before anything used it.
`packages/shared/src/time/eat.ts`. Uganda is UTC+3 year-round with no daylight
saving, so a fixed offset is exactly representable — no tz database, no
ambiguity windows. Nothing reads the system clock or host timezone, so a
server in any region computes the same cutoff. **17 tests**, concentrated where
it actually breaks: evenings after 21:00 UTC when EAT and UTC disagree about
the date, month and year rollovers, and weekends judged in EAT rather than UTC
(a Friday 21:30 UTC is already Saturday in Kampala).

**Origin guard.** `apps/api/src/domain/delivery/DeliveryOrigin.ts` +
**13 tests**. Fixes the class, not the instance: the test asserts
`34/60 + 39/3600 === 0.5775` to record that the whole-degrees component was
dropped, so this is reproducible rather than a typo. The same bounding box
catches `(0,0)`, which is what a missing origin row degrades into, and reports
`NULL_ISLAND` separately from `OUTSIDE_UGANDA` because they are different bugs.

**Seed retirement.** `goldplus_locations_seed.sql` now carries an abort guard
before its first DDL and is renamed `.RETIRED`. Deleting it would have been
weaker — it was supplied as a data artifact and may be re-supplied — so the
enforced rule is that no executable copy may exist and nothing in the tracked
tree references it. **3 tests.**

**Schema (0092).** Origins, corridors, alias corridors, name collisions, the
config registry with immutable versions, learned factors, and the calibration
capture. **The migration contains not one INSERT** — a test pins that, because
"no invented numbers" has to be structural. `corridor` and `distance_band` are
NOT NULL, making PART 9 #9 unreachable rather than merely checked. Bands are
constrained to B0–B6 and a test asserts the retired CORE–REMOTE names cannot
reappear. Coordinates are `numeric`, not float, so 32.57750 round-trips.

**Rider cost capture shipped in stage A**, per Rob's instruction:
`delivery_quote_capture.actual_rider_cost_ugx` exists from day one. NULL means
not known; zero would be a measurement.

**Import.** MD5-gated on all four files, row assertions 1/362/28/84 all fatal,
origin coordinate validated through the Uganda guard before it can reach the
database, every slug checked against the gazetteer, counts re-asserted against
the database after writing.

### Deployment proof
- Backup `pre-0092-20260805-183636.dump` → clone → **REHEARSE_OK
  duration_ms=179** → import into clone → **DELIVERY_IMPORT_OK added=362** →
  **re-run: `added=0 changed=0 unchanged=362`** (PART 9 #12) → applied live →
  **Migrations complete!** → live import → rolled, 4/4 healthy → clone dropped.
- **Production**: origins=1, corridors=362, aliases=28, collisions=84, water=12,
  collision classes 38/18/28 exactly.
- **Origin live**: `HUB-CBD-WILSON 0.313330,32.577500 active=true`, landmarks
  "Next to Uhuru Restaurant / Opposite the Pioneer Mall parking area" — Uhuru
  first.
- **No invented numbers**: `delivery_learned_factor` = 0 rows,
  `delivery_config_value` = 0 rows. The six launch values are unset and the
  module will return `fee_unavailable` until they are.
- Suite: **345 files / 5,534 tests green** (+70 this stage).

---

## 7. Stage B — the one model (2026-08-05)

**One equation, proven by arithmetic.** B2 midpoint 7km → round trip 14km → at
20 km/h = 42 minutes travel → +15 handling = 57 expected minutes → × 100 UGX ×
1.3 = 7,410 → rounded to **7,500**. The fee and the window are produced by one
call from one number, so contract #2 is structural rather than a convention.

**Band midpoints are computed** from the published edges, and a test asserts
each equals `(low + high) / 2` and that the edges are contiguous — so the table
cannot drift from the arithmetic.

**One shrinkage formula**, `(n × observed + k × prior) / (n + k)`, applied to
every learned value with no per-parameter special cases. A value with no sample
IS its prior; at the pseudo-count it is exactly half evidence.

**Rounding** is applied after the margin and **before** the floor, so the floor
always wins — proven by a case where the rounded fee lands under a raised
minimum. Raw, step and rounded are recorded separately.

### The reason enum caught a real modelling gap
Running the 18 orders through the first cut reported the three upcountry orders
as `AREA_UNRESOLVED`. They had resolved **perfectly** — they are simply outside
the metro corridor set. Telling an Adjumani customer we could not find their
address would have been false and would have put them in the wrong ops queue.
`AreaInput` now carries a nullable corridor/band, and the refusal order asks
each question only once the one above it can be answered: an area with no
corridor row has no serviceability flag either, so claiming it unserviceable
would invent a fact.

### Reason for each of the 18 historical orders
| Reason | Count | Which |
|---|---|---|
| `CONFIG_INCOMPLETE` | **15** | every metro order — waiting only on the six launch numbers |
| `AREA_NOT_METRO` | **3** | Esia→Adjumani, Atunga→Abim, Lazebu→Arua — manual path |

No order reports `AREA_UNRESOLVED`, `AREA_UNSERVICEABLE`, `WATER_ACCESS` or
`NO_ACTIVE_ORIGIN`. The moment the six numbers land, 15 of 18 quote.

### The window
No hour window is offered anywhere. It requires **both** an on-time target
(PART 10 #1, unset) **and** a sample large enough for percentiles (none exist).
Day level therefore falls out of two absent values rather than a threshold
anyone invented, and the hour window is earned when both arrive. Nothing is
widened to look cautious.

### The pin nudge
Ships with **no time claim**. A test asserts the copy contains no number,
because zero deliveries have completed with a pin and the with/without split
cannot be fitted. The claim gets added later, from data, as a Tier 1 string.

### PART 9 #9 — no redundant test
`corridor` and `distance_band` are NOT NULL in `delivery_corridor`, so a metro
area without them is **unreachable** rather than checked. Recorded here rather
than duplicated as a test that could never fail.

---

## 8. Verification: is dispatched → delivered actually reachable?

**Yes — proven end to end on a restored clone, and the answer is more precise
than a yes.**

The first attempt FAILED in an instructive way: setting the fulfilment task to
`OUT_FOR_DELIVERY` directly by SQL recorded the delivery but left the order at
`received`, with `order_events` empty. The mirroring is wired but wrapped in a
`catch` that is deliberately non-fatal — a legacy order not in `processing`
refuses the transition, and that refusal must not void a truthfully recorded
physical delivery. So a mis-sequenced order silently does not reach `delivered`;
the audit records `orderTransition: 'skipped'`, which is observable but quiet.

Walking the **real** state machine works:

```
order processing/paid
  task NEW -> PICKING            order=processing
  task -> PACKED                 order=processing
  task -> READY_FOR_DISPATCH     order=processing
  task -> OUT_FOR_DELIVERY       order=dispatched   <- mirrors
  delivery recorded DELIVERED    ORDER STATUS = delivered
  rider cost recorded            = 6,500 UGX
  order_events: dispatched -> delivered
```

**What ops need in practice**, stated plainly:
1. the order must be **paid** and in `processing` — an unpaid order cannot
   dispatch, which is correct and not a bug;
2. the fulfilment task must walk `NEW → PICKING → PACKED → READY_FOR_DISPATCH
   → OUT_FOR_DELIVERY` (no skipping — backward moves are excluded so the audit
   stays honest);
3. then `DELIVERED` mirrors the order to `delivered`.

**The gap that was real:** `actual_rider_cost_ugx` had a column and no way to
write it. Stage B adds `POST /admin/delivery/orders/:orderId/actual-cost`
(ORDERS_MANAGE, audited with before/after, refuses a figure above 5,000,000
UGX as a typo) plus `GET /admin/delivery/awaiting-cost` as the ops queue. Both
proven: cost 6,500 recorded, implausible figure refused with `IMPLAUSIBLE_COST`.

All 18 production orders are unpaid, so **no real order can reach `delivered`
today** — the blocker is payment, not the delivery machinery.

Proof environment destroyed; production verified `captures=0 deliveries=0
delivered_orders=0`.

- Suite: **346 files / 5,580 tests green** (+46 this stage).
