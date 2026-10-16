# Address system, Phase A — runbook

Spec: `docs/location/Kampala_Metropolitan_Address_System_Spec.md` (PR #115). This is what the owner runs, in order,
once the Phase A code is merged. **Nothing in Phase A changes a fee.** The points are loaded, measured against the
bands the team assigned by hand, and recorded on every quote; the model keeps pricing by band midpoint until the
Control Centre key `distance_source` is set to `measured`, which is a later, reversible decision.

## What Phase A.1 built (implementation note against the spec)

The spec's §3.1 proposed a new `geo_area_point` table. The corridor rows already carried `centroid_lat / lng /
source / sample_size` since migration 0092, read by the resolver and written to the capture, so Phase A.1 fills
**those** and adds what was missing (`centroid_expected_error_m`, `centroid_source_ref`, `centroid_shared_polygon`,
`centroid_updated_at`). `geo_area_point` is deferred until points are needed for areas outside the metro set. No
Postgres extension is needed (one haversine per quote; the radius queries are Phase C). Buildings-weighted points are
deferred; this pass uses the parish polygon's geometric centroid with an error derived from its size.

| Piece | Where |
|---|---|
| Migration 0189 (corridor columns, capture columns, `ug_area.area_kind`) | `apps/api/src/infrastructure/db/migrations/0189_delivery_corridor_parish_centroids.sql` |
| Data: 7,566 parish centroids, MD5-pinned | `data/geo/ug_parishes_2016_centroids_wgs84.csv`, `data/geo/README.md` |
| Matching, error, area kind, band agreement (pure) | `apps/api/src/domain/delivery/ParishCentroids.ts` |
| District lineage families | `packages/shared/src/locations/districtLineage.ts` |
| The importer (dry run by default) | `apps/api/src/scripts/geo-import-parish-centroids.ts`, `pnpm -F @goldplus/api geo:parish-centroids` |
| Resolver carries `centroidKm`; use case prices with it only when `distance_source = measured` | `DeliveryAreaResolver.ts`, `DeliveryQuotingUseCase.ts` (`withMeasuredDistance`) |
| Every capture records `accuracy_tier`, `centroid_km`, `centroid_expected_error_m` | `Registry.ts`, `DrizzleDeliveryCaptureRepository.ts` |
| Registry key `distance_source` (ships `band_midpoint`) | `DeliveryConfigRegistry.ts`, `docs/delivery/CONFIGURATION.md` |
| Corridor CSV apply (digest-confirmed, audited) + Control Centre card | `DeliveryCorridorCsvUseCase.ts` (`ApplyCorridorCsvUseCase`), `routes/admin/delivery.ts`, `admin/delivery/index.astro` |
| Location accuracy report (spec §0's four numbers) | `DeliveryReportUseCases.ts`, `GET /admin/delivery/reports/location-accuracy`, `admin/delivery/calibration.astro` |
| Tests | `tests/unit/ParishCentroids.test.ts`, `DeliveryAccuracyTier.test.ts`, `CorridorCsvApply.test.ts`, `DeliveryLocationAccuracyReport.test.ts`; `tests/integration/ParishCentroidImport.integration.test.ts`, `DeliveryCaptureAccuracy.integration.test.ts` |

Also built, because the runbook's own Step 5 depended on it and it did not exist: the **apply half of the corridor
CSV round trip**. The Control Centre had an export and a dry run (`POST /admin/delivery/corridors/dry-run`) and no way
to land what the dry run showed, so a re-band could only be done by hand in the database. Now: the dry run returns a
digest of exactly its changes; `POST /admin/delivery/corridors/apply` refuses anything but that digest, writes the
changes in one transaction and one audit row (`DELIVERY_CORRIDORS_APPLIED`); the Control Centre has a **Corridor
file** card (paste → Dry run → Apply). The importer's `--reband-csv` writes the file for it. And a **Location
accuracy** panel on the calibration page shows the four numbers of spec §0 from the capture's own columns.

**Review board, 2026-10-15 (eleven independent reviews; synthesis in `docs/location/REVIEW_BOARD_2026-10-15.md`).**
What changed in this PR because of it: numbered parishes (Kibuye I/II, Kololo I–IV) and dotted acronyms are told
apart before the orthography fold collapses them; "Gombe" and "Gombe Ward" are different parishes; a fuzzy match
needs the score (≥ 0.7) and a shared first letter, never a lone 0.61; the band verdict is by band, with the point's
own error as the edge tolerance and a new "adjacent" list; a **point guard** refuses shoreline and water-body
polygons whose centre is in the lake; the expected error is a p90 (disc or bounding-box RMS) so it is comparable
with pins later; "Estate" is a neighbourhood; `area_kind` has provenance and all 5,805 gazetteer rows are classified;
the source reference is keyed by the shapefile's unique record id; counters come from the rows the database says it
wrote; both corridor writers take one advisory lock; the corridor dry run reads the shop's own quoted export, refuses
duplicate rows, apply needs a reason and a batch reverts in one action; **delivery outcomes now reach the quote
capture** (`delivered_at`, `actual_minutes` from the dispatch time, `first_attempt_success` false on a failed first
attempt), without which two of the four numbers and the whole calibration loop had no data; the report windows
minutes and attempts on the delivery date, measures the model-priced share against own-rider quotes and shows the
signed median; coordinates and map links are redacted from the assistant archive; and the lineage, name variants,
area-kind rules, acceptance areas and file checksums are **data files under `data/geo` with a MANIFEST**, every run
recorded in `geo_data_source_run` with vintage, checksum and parameters. Follow-up observations implemented in the same PR: one configuration snapshot per process (a quote no longer reads the
two config tables eight times; publish and revert clear it), both origin readers pick the same hub, the quote path
refuses door delivery to a reserve, lake or island whatever its band, an area that is a parish's reference village
(Najjera → Kira) matches on the file's own evidence, `data/geo/corridor-allowances.csv` gives the band report a
per-corridor detour allowance (empty until the dry run's corridor names are copied in), and the Corridor file dry run
refuses a file over 5,000 rows.

Not in A.1 (deliberately): accepting unknown districts at checkout (the boundary refuses them today on purpose; a
decision for the owner, spec §7.1), the fee ladder (spec §4.5, decision 1), the fee-step counter, `ug_district` as a
table (the lineage is a reviewed constant until the admin form exists). Points placed by a fuzzy name match are
stored like any other but carry the method and score in `centroid_source_ref` (`…#fuzzy:0.71`), so they can always be
found and questioned.

## Step 1 — deploy (migrations 0189–0191, then the api)

After the PR is merged into `deploy/price-floor-145k`. Paste on the Mac as one block:

```
ssh goldplus-prod 'bash -s' <<'EOF'
set -euo pipefail
cd /opt/goldplus/app/goldplus-commerce
git fetch -q origin deploy/price-floor-145k
SHA=$(git rev-parse --short=8 origin/deploy/price-floor-145k)
WT=/tmp/mig-$SHA
[ -d "$WT" ] || git worktree add --detach "$WT" "$SHA" >/dev/null
docker build -q --target builder -f "$WT/goldplus-commerce/Dockerfile.api" -t goldplus-migrator:$SHA "$WT/goldplus-commerce" >/dev/null
scripts/migrate-prod.sh goldplus-migrator:$SHA geo-phase-a-0191 "select count(*) from information_schema.columns where table_name='fulfilment_dispatches' and column_name='stops_on_trip'" 1 # 0189+0190+0191 land together; this proves the last one
# original check: "select count(*) from information_schema.columns where table_name='delivery_corridor' and column_name='centroid_expected_error_m'"
scripts/deploy-prod.sh $SHA api web
echo "DONE $SHA"
EOF
```

Then `bash scripts/live-smoke.sh` from the Mac as after every deploy. Fees are unchanged at this point. (Both
services: the api carries the migration and the routes, the web carries the two Control Centre panels.)

## Step 2 — Week 0 baseline (read-only)

Five numbers the spec's decisions 1–3 are made on. Paste as one block; copy the output into the decision thread.

```
ssh goldplus-prod 'bash -s' <<'EOF'
set -euo pipefail
q() { docker exec goldplus-commerce-postgres-1 sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -tAc \"$1\""; }
echo "== how fees were priced, last 28 days (priced_by | count)"
q "select coalesce(priced_by,'legacy'), count(*) from delivery_quote_capture where created_at > now() - interval '28 days' group by 1 order by 2 desc"
echo "== minutes error, last 28 days (orders with both numbers | median |expected-actual| minutes)"
q "select count(*) filter (where expected_minutes is not null and actual_minutes is not null), percentile_cont(0.5) within group (order by abs(expected_minutes - actual_minutes)) from delivery_quote_capture where created_at > now() - interval '28 days'"
echo "== first-attempt success, last 28 days (succeeded | known)"
q "select count(*) filter (where first_attempt_success), count(*) filter (where first_attempt_success is not null) from delivery_quote_capture where created_at > now() - interval '28 days'"
echo "== WhatsApp location pins already received and dropped into text"
q "select role, count(*) from assistant_messages where content like 'My location:%' group by role"
echo "== orders whose address text names a landmark (with landmark words | all orders)"
q "select count(*) filter (where delivery_address ~* '\m(near|opposite|opp|behind|next to|after|before|off)\M'), count(*) from orders"
echo "== corridor areas by centroid source (before the import)"
q "select coalesce(centroid_source,'none'), count(*) from delivery_corridor group by 1 order by 2 desc"
EOF
```

## Step 3 — the parish centroid DRY RUN (writes nothing)

Matches the 362 metro areas to the 2016 parishes, measures each point against its hand-assigned band, and prints the
three lists (suspect band, suspect match, ambiguous) plus the ten acceptance areas. Read it before Step 4.

```
ssh goldplus-prod 'bash -s' <<'EOF'
set -euo pipefail
cd /opt/goldplus/app/goldplus-commerce
git fetch -q origin deploy/price-floor-145k
SHA=$(git rev-parse --short=8 origin/deploy/price-floor-145k)
WT=/tmp/mig-$SHA
git worktree prune
[ -d "$WT" ] || git worktree add --detach "$WT" "$SHA" >/dev/null
IMG=goldplus-migrator:$SHA
docker image inspect "$IMG" >/dev/null 2>&1 || docker build -q --target builder -f "$WT/goldplus-commerce/Dockerfile.api" -t "$IMG" "$WT/goldplus-commerce" >/dev/null
mkdir -p /root/geo-reports
docker run --rm --network goldplus-commerce_default --env-file .env.production \
  -e DATABASE_URL="$(grep -E '^DATABASE_URL=' .env.production | cut -d= -f2-)" \
  -v "$WT/goldplus-commerce/data:/app/data:ro" -v /root/geo-reports:/app/reports \
  "$IMG" pnpm -F @goldplus/api geo:parish-centroids --by=owner --report=/app/reports/parish-centroids-dryrun-$SHA.csv --reband-csv=/app/reports/parish-reband-$SHA.csv \
  2>&1 | tee /root/geo-reports/parish-centroids-dryrun-$SHA.log | tail -150
EOF
```

The same numbers appear in the Control Centre once the import has applied (Step 4): `/admin/delivery/calibration` →
Location accuracy.

What to look for: the parameter line (allowance, fuzzy threshold, lineage rows, name variants) so a later reader
knows what produced the run; `matched N/362` and how many the **point guard refused** (shoreline parishes whose
centre is in the lake: Kigungu, Nkumba, Kisubi, Busabala, Bussi, Koome, Ggaba, Luzira — these need a manual point,
not a centroid); the **suspect BAND** list (clean matches whose point is in another band and not near an edge: the
bands most worth re-checking); the **adjacent** list (within the point's own error of an edge: read, never
re-banded); and the acceptance areas, which resolve through the shop's aliases as well as area names (Najjera,
Kajjansi, Munyonyo and Mukono town are villages inside bigger 2016 parishes, so they print either via an alias or
as a named gap). `suspect MATCH` and `ambiguous` go to `/admin/locations` later; nothing is done with them in
Phase A. Every run, dry or applied, writes a row to `geo_data_source_run` with the file's checksum, vintage and
parameters.

## Step 4 — APPLY (stores the centroids; still no fee change)

Same block with `--apply`. Idempotent: run it twice and the second reports `changed=0`. It never overwrites a
`manual` or `delivered_pins` centroid and never touches a band.

```
ssh goldplus-prod 'bash -s' <<'EOF'
set -euo pipefail
cd /opt/goldplus/app/goldplus-commerce
git fetch -q origin deploy/price-floor-145k
SHA=$(git rev-parse --short=8 origin/deploy/price-floor-145k)
WT=/tmp/mig-$SHA
git worktree prune
[ -d "$WT" ] || git worktree add --detach "$WT" "$SHA" >/dev/null
IMG=goldplus-migrator:$SHA
docker image inspect "$IMG" >/dev/null 2>&1 || docker build -q --target builder -f "$WT/goldplus-commerce/Dockerfile.api" -t "$IMG" "$WT/goldplus-commerce" >/dev/null
mkdir -p /root/geo-reports
docker run --rm --network goldplus-commerce_default --env-file .env.production \
  -e DATABASE_URL="$(grep -E '^DATABASE_URL=' .env.production | cut -d= -f2-)" \
  -v "$WT/goldplus-commerce/data:/app/data:ro" -v /root/geo-reports:/app/reports \
  "$IMG" pnpm -F @goldplus/api geo:parish-centroids --apply --report=/app/reports/parish-centroids-applied-$SHA.csv --reband-csv=/app/reports/parish-reband-$SHA.csv \
  2>&1 | tee /root/geo-reports/parish-centroids-applied-$SHA.log | tail -40
docker exec goldplus-commerce-postgres-1 sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -tAc \"select coalesce(centroid_source,'none'), count(*) from delivery_corridor group by 1 order by 2 desc\""
git worktree remove --force "$WT" 2>/dev/null || true
echo "APPLIED $SHA"
EOF
```

From the next quote on, every capture carries `accuracy_tier` and `centroid_km`. Customers see nothing different.

## Step 5 — re-band the suspect areas (Control Centre; a person decides every row)

The import wrote `/root/geo-reports/parish-reband-<sha>.csv`: the whole corridor table in the Control Centre's CSV
shape, with only the **suspect-band** rows carrying the band their measured point suggests. Nothing else differs.

1. Copy it to the Mac: `scp goldplus-prod:/root/geo-reports/parish-reband-<sha>.csv ~/Downloads/`
2. Open it, read the rows the dry-run log listed under *suspect BAND*, and delete the line of any area you do not
   want moved (a deleted line is simply "no change" to the dry run).
3. `/admin/delivery` → **Corridor file** → paste the file → **Dry run**. It lists every band that would change and
   refuses any malformed or duplicated row. The shop's own export (quoted cells) reads back the same way.
4. **Apply**, with a reason (kept with the change, contract #9). One transaction under the corridor write lock, each
   row compare-and-set on the value the dry run showed, one audit row; the quote cache turns over within a minute.
   The message names the batch id; **reverting that batch is one action** (the batch is refused for revert only if
   one of its areas moved again since). Lake and island areas are never in the proposal file.

Fees for the moved areas change at their next quote (contract #5: a quote already given stays). Customers in areas
that were in the wrong band were paying the wrong fee; that is what this step corrects.

## Step 6 — Phase B is in this PR too (0190, 0191). What it does and what the owner switches on

Everything below ships OFF or inert until the owner acts; no fee changes by itself.

**Already live once deployed (no switch):**
- A WhatsApp location from a customer is answered by the delivery module, never the model: "Is this where we
  deliver order GP-1234?" with Yes / No buttons; the pin is stored only on Yes (`delivery_order_pin`, purged after
  `pin_retention_days`, default 180), the capture is marked PIN, and a pin more than 5 km from the chosen area opens
  a care task for a person. A customer with an account is then asked "Save this spot to your address?" (second tap).
  No open order in 14 days → told, nothing stored. Outside Uganda or at the shop → refused. Coordinates never reach
  the assistant archive (placeholder `[Location shared]`).
- Account → Addresses shows a saved pin with **Remove pin**. The privacy page states the retention.
- Checkout sends the picker's pin with the quote (PIN tier; a pin with no area named resolves to the nearest area
  point only when unambiguous). A district the list does not know is accepted on the manual path.
- Dispatch form: pick a rider (Delivery → Riders, `delivery_riders`) and the stops on the trip. A location that
  rider shares on WhatsApp while a stop is out asks Delivered / Customer not there / Couldn't find it, records the
  attempt with the handover point, then Easy / Hard to find.

**One nightly timer the host must have (there was none for calibration either):** `ops/delivery-nightly/` installs
`goldplus-delivery-nightly.timer` (02:30 Kampala) which runs, inside the live api container, the calibration
proposals, then pins → area points, then the pin purge. Install per its README (three commands). Each area-point
run writes a row to `geo_data_source_run` (`source_name = 'nightly-area-points'`; wide-spread areas in `params`).

**Owner switches (Control Centre → setup, published as a version like any value):**
1. `fee_shape = ladder` + `fee_ladder = "3000, 5000, 8000, 12000, 20000"` (your numbers). Run the **Fee ladder** dry run
   on the Control Centre first: it lists every area's rung, what changes, and any nearer area dearer than a farther one.
   The **margin alarm** on the Calibration page flags a rung whose orders ran over cost in more than
   `ladder_margin_alarm_pct` (default 10%) of cases.
2. The pin nudge (`copy_pin_nudge`, "…delivery is UGX {{saving}} less") shows itself only when the nightly calibration
   has learned last-mile minutes for an area both with and without a pin (proposal scope `<area>#pin`, accepted by a
   person) and the difference is at least one rounding step. Nothing to switch; it appears when it is true.
3. Add riders under Delivery → Riders before relying on handovers; until then every location is a customer pin.

## Step 7 — what happens next (not in this runbook)

1. Decide the fee shape (spec §12, decision 1): the ladder dry run is the tool.
2. Set the six launch numbers (spec §11), by the seven questions or by trip prices.
3. Landmarks mined from orders, meeting points, OSRM road km (spec §6, §4.2).

## Rollback

Columns are additive and unread by older code, so the columns can stay. **`deploy-prod.sh` refuses a sha that is not
the deploy branch's tip**, so "roll the previous sha" does not work: revert the PR on `deploy/price-floor-145k`
(`gh pr revert`, or a revert commit) and roll the new tip with the usual block. Data, in order:
1. Re-bands applied from the Corridor file card: revert the batch (`POST /admin/delivery/corridors/batches/<batchId>/revert`
   with a reason; the batch id is in the apply message and in the audit log under `DELIVERY_CORRIDORS_APPLIED`). It is
   refused if any of those areas moved again since, and then the audit row's `changes` (from → to) is the record to
   undo by hand.
2. Centroids: `update delivery_corridor set centroid_lat = null, centroid_lng = null, centroid_source = null, centroid_source_ref = null, centroid_expected_error_m = null, centroid_shared_polygon = false, centroid_updated_at = null where centroid_source = 'parish_centroid'`.
3. Area kinds the import set: `update ug_area set area_kind = 'neighbourhood' where area_kind_source = 'pattern'`.
Nothing the import wrote changes a fee while `distance_source` is `band_midpoint`, so a rollback is never urgent.
