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
| Tests | `tests/unit/ParishCentroids.test.ts`, `tests/unit/DeliveryAccuracyTier.test.ts`, `tests/integration/ParishCentroidImport.integration.test.ts` |

Not in A.1 (deliberately): accepting unknown districts at checkout (the boundary refuses them today on purpose; a
decision for the owner, spec §7.1), the fee ladder (spec §4.5, decision 1), the fee-step counter, `ug_district` as a
table (the lineage is a reviewed constant until the admin form exists).

## Step 1 — deploy (migration 0189, then the api)

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
scripts/migrate-prod.sh goldplus-migrator:$SHA geo-phase-a-0189 "select count(*) from information_schema.columns where table_name='delivery_corridor' and column_name='centroid_expected_error_m'"
scripts/deploy-prod.sh $SHA api web
echo "DONE $SHA"
EOF
```

Then `bash scripts/live-smoke.sh` from the Mac as after every deploy. Fees are unchanged at this point.

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
q "select count(*) from assistant_messages where role = 'user' and content like 'My location:%'"
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
[ -d "$WT" ] || git worktree add --detach "$WT" "$SHA" >/dev/null
IMG=goldplus-migrator:$SHA
docker image inspect "$IMG" >/dev/null 2>&1 || docker build -q --target builder -f "$WT/goldplus-commerce/Dockerfile.api" -t "$IMG" "$WT/goldplus-commerce" >/dev/null
mkdir -p /root/geo-reports
docker run --rm --network goldplus-commerce_default --env-file .env.production \
  -e DATABASE_URL="$(grep -E '^DATABASE_URL=' .env.production | cut -d= -f2-)" \
  -v "$WT/goldplus-commerce/data:/app/data:ro" -v /root/geo-reports:/app/reports \
  "$IMG" pnpm -F @goldplus/api geo:parish-centroids --report=/app/reports/parish-centroids-dryrun-$SHA.csv \
  2>&1 | tee /root/geo-reports/parish-centroids-dryrun-$SHA.log | tail -150
EOF
```

What to look for: `matched N/362` (89% is expected by exact name; folding should take it past 95%), the **suspect
BAND** list (exact matches whose point is nowhere near the band they were given: the bands most worth re-checking),
and the ten acceptance areas with their km. `suspect MATCH` and `ambiguous` go to `/admin/locations` later; nothing
is done with them in Phase A.

## Step 4 — APPLY (stores the centroids; still no fee change)

Same block with `--apply`. Idempotent: run it twice and the second reports `changed=0`. It never overwrites a
`manual` or `delivered_pins` centroid and never touches a band.

```
ssh goldplus-prod 'bash -s' <<'EOF'
set -euo pipefail
cd /opt/goldplus/app/goldplus-commerce
SHA=$(git rev-parse --short=8 origin/deploy/price-floor-145k)
WT=/tmp/mig-$SHA
IMG=goldplus-migrator:$SHA
docker run --rm --network goldplus-commerce_default --env-file .env.production \
  -e DATABASE_URL="$(grep -E '^DATABASE_URL=' .env.production | cut -d= -f2-)" \
  -v "$WT/goldplus-commerce/data:/app/data:ro" -v /root/geo-reports:/app/reports \
  "$IMG" pnpm -F @goldplus/api geo:parish-centroids --apply --report=/app/reports/parish-centroids-applied-$SHA.csv \
  2>&1 | tee /root/geo-reports/parish-centroids-applied-$SHA.log | tail -40
docker exec goldplus-commerce-postgres-1 sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -tAc \"select coalesce(centroid_source,'none'), count(*) from delivery_corridor group by 1 order by 2 desc\""
git worktree remove --force "$WT" 2>/dev/null || true
echo "APPLIED $SHA"
EOF
```

From the next quote on, every capture carries `accuracy_tier` and `centroid_km`. Customers see nothing different.

## Step 5 — what happens next (not in this runbook)

1. Read the suspect-band list and re-band those areas through the Control Centre's corridor dry run (the existing
   path; the import never does it).
2. Decide the fee shape (spec §12, decision 1: re-band onto a ladder, re-band only, or `distance_source = measured`).
3. Set the six launch numbers (spec §11), by the seven questions or by trip prices.
4. Phase B: WhatsApp pins to the order, rider handover, saved addresses that remember (spec §5).

## Rollback

Columns are additive and unread by older code: `scripts/deploy-prod.sh <previous sha> api web` is a full rollback of
behaviour; the columns can stay. To undo the data only:
`update delivery_corridor set centroid_lat = null, centroid_lng = null, centroid_source = null, centroid_source_ref = null, centroid_expected_error_m = null, centroid_shared_polygon = false, centroid_updated_at = null where centroid_source = 'parish_centroid'`.
