# Location Module — Build Progress Log

Stage-by-stage record per the approved PART 1 plan. Suite state, retirements,
assumptions and surprises land here as each stage completes.

## Stage 1 — audit + plan (2026-08-04) ✅
Delivered in-session; approved. Baseline: 285 test files / 5,010 tests green.

## BLOCKER NOTICE (2026-08-04, stage-2 start)
The six data files are NOT in `data/locations/v1/` — the directory does not
exist and a machine-wide search finds none of the six filenames. Import,
data-dependent search proofs, offline index content and most PART N items wait
on them. Everything file-independent is being built now; the import runs the
moment the files land (MD5-gated, all assertions coded).

## Stage 2 — schema, import machinery, lifecycle, wreckage (2026-08-04) ✅
**Shipped** (commit b7cb247, migration 0084 rehearsed REHEARSE_OK on a restored
clone → live → api+web rolled, 4 healthy):
- Extensions pg_trgm/unaccent/btree_gin CREATED (were available-not-installed).
- Tables: ug_area (+GIN trigram on search_text), ug_area_alias, ug_area_group
  (+members), ug_data_exception, ug_landmark (unique area+lower(name)),
  ug_pickup_point, ug_search_miss, delivery_zone_policy (Z1–Z4 seeded with
  code-as-name, every policy value NULL, active=false — activation blocked),
  address_audit. addresses evolved additively to the customer_address shape
  (guest-capable user_id, gps/pin fields, resolution_status, delivery_method,
  snapshots, soft delete).
- ORDER LIFECYCLE (authorised scope): new states dispatched / delivered /
  delivery_failed in the canonical state machine; completed still reachable for
  non-delivery closure; delivered terminal; delivery_failed re-dispatchable.
  WRITERS: TransitionFulfilmentTaskUseCase now mirrors OUT_FOR_DELIVERY →
  order 'dispatched', and RecordDeliveryUseCase (existing, routed, never-used
  attempt recorder that populates fulfilment_deliveries) now mirrors
  DELIVERED → 'delivered' and DELIVERY_FAILED → 'delivery_failed' — all via
  OrderTransitionService so every hop lands in order_events. Admin order UI
  gained the new transitions + filters.
- delivery_location double-encoding FIXED both directions: jsonbStrict custom
  type on writes (drizzle/postgres-js stringify bug), backfill normalised all 5
  live rows with verbatim originals kept in delivery_location_raw.
- MD5-gated import script (apps/api/src/scripts/import-locations.ts): strict
  CSV parser, every PART D/E assertion incl. Terego-zero-areas, idempotent
  upserts, de-list-never-delete, changelog diff report. BLOCKED ON DATA FILES.
- Orthography folding shipped early (needed by search_text): full F.2 positive
  suite + the three negative traps (16 tests).
- Wreckage cleared: 5 dangling scripts, temp_source.json, dead gazetteer types
  (+their re-exports) removed; anti-resurrection guard test pins them deleted;
  fulfilment deliverySummary now reads lean payloads; malformed-locationJson
  resilience test restored; alias-uniqueness guard added.
**Test count**: 285 → 287 files / 5,010 → 5,043 tests, all green (architecture
tier 104/104 — two origin guards had been red since the shopping-assistant
hotfixes; resolved by routing checkout + finder client scripts through
publicApiBase, which is those guards' intent).
**Surprises**: (1) stage-1 forensics wrongly reported DISTRICT_SPELLING_VARIANTS
as 4 entries missing KATAWI/NTUGAMO — the map actually carries both; no fix
needed. (2) fulfilment_deliveries recording machinery already existed fully
routed — the gap was only that nothing bridged outcomes to the ORDER lifecycle.
(3) The known dirty-tree Slice09 diff guards flag mid-stage runs and clear on
commit, as designed.
**Assumption recorded**: delivery_zone (brief) → delivery_zone_policy (repo has
a delivery_zones fee table already; decision #7 keeps fees there).

## Stages 3–4 — search pipeline + APIs (2026-08-04) ✅ (commit 443e5a0, deployed)
F.1 pipeline + F.3 ranking as a pure service (19 tests incl. group collapse,
provenance dedupe, duplicate-name disambiguation, cap 8); F.2 folding proven
both ways with the three negative traps; G.1 link parsing (all documented
shapes, Uganda bounding box, SSRF-contained goo.gl resolver); strict E.164
phone normalisation (warn-never-block). Public /locations under a dedicated
300/min family (never global); admin /admin/locations per the approved
permission table; PUT address edit with before/after audit; soft-delete
addresses. LIVE: /locations/search returns honest zeroResult until the data
files arrive — and logs each miss (the learning loop is running in production
before the gazetteer even lands).

## Stages 6–9 — form, offline, rider handoff, admin (2026-08-04) ✅ (commits df4da4b, 14b82d7, deployed)
Picker v2 on all six call sites (server search + offline fallback + manual
PART H path + pin capture); checkout gains pickup-point method, redemption
control, honest lower-bound earn preview, draft persistence, add_shipping_info;
offline index generator (2.5KB gz vs 60KB budget; gazetteer-mode after import)
precached by SW v3 on a dedicated URL — SENSITIVE_ROUTES untouched; rider
delivery card (print/WhatsApp-copy/wa.me/map-pin/net-COD); COD zone gating +
order-velocity fraud signal; /admin/locations workspace with all six J.1 views.
**Test count**: 305 files / 5,185 (+1 honest data-gated skip). Admin census
87→88 (named change: new admin page, fails closed).
**Blocked on data files**: import run, EXPLAIN ANALYZE p95 proof, stage 5
match-rate report, gazetteer-mode offline index, most PART N proofs.

## Stage 10 — acceptance + rollout prep + close (2026-08-05) ✅ code-complete / ⏸ data-gated (deployed at 43d01ea)
PART N acceptance: every file-independent item demonstrated — targeted cluster
7 files / 110 tests + 1 data-gated skip green (folding both ways, ranking,
duplicate-name disambiguation, group behaviour, manual fallback, link parsing,
phone normalisation = N#27); full suite 338 files / 5,362 vs 285 / 5,010
baseline, no deletions (retirements: era-pin relocations only, named in the
loyalty log; admin census 87→88, COMMERCE_OS modules 15→16, both named).
Live: /locations/search serves honest zeroResult; miss capture already logged
1 real production miss; offline index live on its dedicated URL (9,883 B raw /
2,574 B gz vs 60KB budget) and SW-precached; picker script 16.1KB raw / 4.8KB
gz (single-digit budget held); zones Z1–Z4 all-NULL and activation-blocked in
production (Option A: unset means unset).
DATA-GATED (files never found on the machine, MD5 gate unpassable): N#1–N#5
import + migration + match rate + GP-202608-DBF2 correction, N#6–N#11 live
resolution proofs, PART O 20-address 80% gate, EXPLAIN ANALYZE p95. Scripts
are ready to run the moment `data/locations/v1/` lands.
PART O prep: two-key flag ships OFF (old flow intact = rollback); canary plan
+ weekly ops-queue review documented in the closing report. PART P delivered
as one sheet (docs/location-module-decisions.md, commit 98b3a01).
Deploy hygiene fallout fixed during close: .dockerignore (4641791) + image
chmod normalisation (43d01ea).

## Stage 5 + PART N/O acceptance — DATA LANDED (2026-08-05) ✅ commit 884ac70
Rob supplied the five gazetteer files. **All five MD5s matched the approved
table exactly**, so the hard gate passed on the first attempt.

### Row counts (PART N #1)
5,805 areas · 28 aliases · 135 districts · 255 exceptions · 362 metro areas —
every figure exactly as the brief specified.

### Defects the real data exposed (the script was written blind)
1. **Alias columns**: the name column is `alias_or_missing_name`, not `alias`;
   confidence is `attribution_confidence`. Both were hard failures.
2. **Exception columns**: type is `issue_type`, description is `treatment`.
   Also a hard failure.
3. **Dropped fields**: `county_or_division` and `sub_county_clean` were being
   discarded.
4. **District spellings**: the 2019 source writes Kasanda/Kikube where the
   official list has Kassanda/Kikuube. Added to the spelling-variant map —
   the CSVs were not touched and the district vocabulary stayed closed.
   With those mapped, exactly one vocabulary district has zero areas:
   **Terego** — the 135-vs-136 gap the brief predicted, now proven from data.
5. **`search_text` omitted the county**, so *Entebbe* — which exists only as
   the municipality over Central/Katabi/Kigungu/Kiwafu Wards — was completely
   unsearchable (N#7 "ntebbe" returned nothing).
6. **Search matched only the START of `search_text`**, so any term after the
   first word was unreachable. Now matches at any word boundary, still as a
   per-word prefix so the negative traps hold.
7. **No area groups were seeded**, so "nsambya" returned four fragments
   (N#10). COLLOQUIAL_UMBRELLA aliases now become groups with membership
   DERIVED from the data: Nsambya/Kampala 4 members, Seeta/Mukono 2.
8. **Changelog write failed an import that had already committed** — it now
   logs instead of failing.

### PART N acceptance — live against api.shopgoldplus.com
- **N#1** 5,805/28/135/255 loaded, all assertions passing. **IMPORT_OK
  added=5805**.
- **N#2** re-run changes nothing: **added=0 changed=0 unchanged=5805
  delisted=0**.
- **N#3** the two non-selectable records (Shimoma malformed postcode,
  Kiryandongo missing parish name) are excluded from every customer result.
- **N#6/7/8** ntinda · bugolobi · lubaga · matugga · najera · kisasi · gaba ·
  ntebbe · kalerwe · najjera · namugongo · kajjansi — **all twelve resolve**.
- **N#9 negative traps ALL PASS**: bunga→Buziga (no Busanga),
  kasangati→Nangabo (no Kasana), namasuba→Bunamwaya (no Namayuba).
- **N#10** nsambya returns ONE `group_exact` entry "Nsambya, Kampala".
- **N#12** offline index live: gazetteer mode, 390 entries, 42KB raw /
  **8KB gzipped** vs the 60KB budget.
- **Performance**: EXPLAIN ANALYZE on the real 5,805-row table — exact 4.3ms,
  word-boundary prefix 0.36ms, trigram 16.7ms. End-to-end API mean **52ms**,
  max 73ms. The 200ms gate is met with two orders of magnitude to spare.

### PART O 20-address gate
Twenty real destinations from past orders, run through the live matcher:
**20/20 = 100%**, against an 80% gate.

Two defects were caught in the dry run *before* anything was written:
- "Kampala" matched `sembabule-kampala-32530` — a parish called Kampala in
  Sembabule — on two real orders. A district-name probe now resolves inside
  that district, and the audit says plainly it is a DISTRICT-LEVEL match with
  the specific area not known.
- **GP-202608-DBF2** stayed unmatched because the order records "Kira, Mukono"
  while Kira is in Wakiso. A cross-district fallback now resolves it and
  records: *"DISTRICT CORRECTION — Kira resolves to Wakiso, not the Mukono
  stored on the order."* The order text is **unchanged**: `Kira | Kira,
  Mukono`, district still Mukono. 20 `migration_linked` audit facts written;
  no order was rewritten.

### Still deliberately unset
All four delivery zones remain `active=false` with SLA and COD **UNSET** —
Option A holds: unset means unset, and nothing defaults.

Suite: **341 files / 5,484 tests green** (one fewer skip — the data-gated
Terego guard now runs for real).
