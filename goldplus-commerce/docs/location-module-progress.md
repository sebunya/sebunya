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
