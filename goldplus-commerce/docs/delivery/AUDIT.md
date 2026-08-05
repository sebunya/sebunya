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
