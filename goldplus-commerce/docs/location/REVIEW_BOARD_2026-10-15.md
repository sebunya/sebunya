# Address system, Phase A.1 — review board, 2026-10-15

Eleven independent, read-only reviews of PR #116 and the spec (`Kampala_Metropolitan_Address_System_Spec.md`, PR
#115), each with a narrow brief and the same two cross-cutting questions: which data is older than 2025 and how its
vintage should be made explicit (the owner's rule: 2025 data is the best we can rely on), and what must be
configurable without a deploy. Every finding that changed code was re-run against the real functions before it was
acted on; the ones that did not hold are noted.

| Reviewer | Verdict | Top finding |
|---|---|---|
| QA | ship after fixes | the runbook's rollback line is a command `deploy-prod.sh` refuses; the export quotes cells the dry run cannot read; duplicate slugs apply last-wins |
| Principal engineer | do not merge as-is | the corridor round trip could not round-trip; apply lacked reason and revert (contract #9); three km→band functions with different edge rules |
| Domain expert (Kampala) | ship only with guards | shoreline parish centroids sit in Lake Victoria (Kigungu, Nkumba, Kisubi, Busabala, Bussi, Koome, Ggaba, Luzira); 2016 parishes do not name the places customers say; "Estate" is a housing estate |
| Algorithm specialist | fix before storing points | the orthography fold collapses II into I, so every numbered Kampala parish was ambiguous; Dice 0.6 accepted "Kazo Nabweru" → Nabweru North as a lone winner; the ±2 km test passed 80–90% of wrong Kampala matches |
| Data scientist | fix before reading a number | nothing wrote `actual_minutes`, `delivered_at` or `first_attempt_success`; expected (round trip + handling) and any observable actual (dispatch → door) are on different bases |
| Boda rider | fix the handover flow | riders will not send a pin at the door with five taps; bind pins to the dispatch by one button, not by radius; rider card order is wrong; Plus Codes mean nothing on the road |
| Customer advocate | fix three HIGHs before Step 5 | a re-banded fee moves with no explanation; the WhatsApp ask captures the wrong place for orders placed from work; pins have no consent, no "Remove pin", no visible retention |
| Database specialist | migration safe; fix before first apply | `area_kind` re-runs reverted admin edits; PCODE is not unique (23 duplicates); counters ignored the UPDATE's row count; no lock between the two corridor writers |
| AI engineering | fix the parser first | a customer's WhatsApp pin is answered today with directions to the shop (router STORE rule); coordinates are archived for a year and replayed into model calls |
| Optimisation | A.1 adds ~0 cost | the quote path makes 8 redundant config reads per miss (pre-existing); the apply loop is one statement per field; the report needed a `created_at` index |
| Data recency & configuration | adopt manifest + run table | the canonical 146 is a newspaper number and omits Kisoko and Bughendera (deemed created July 2025); lineage, variants and checksums were code; no point recorded which year's geometry produced it |

## What changed in PR #116 because of the board (commit after `afb5b001`)

**Matching (verified by re-running the reviewers' counter-examples).** Numerals and dotted acronyms are normalised
before the fold (`matchKey('Kibuye I I') === matchKey('KIBUYE II')`); a bare name against numbered parishes is
ambiguous, not a guess; the unit word ("Ward") is a tie-break between otherwise identical keys; a fuzzy match needs
Dice ≥ 0.7, a relative margin, a key of six or more characters and a shared first letter (the reviewer's "first three
letters" rule would have rejected Bogolobi/Bugolobi, so it is one letter). `Kazo Nabweru` and `Namugongo` are now
unmatched rather than wrong. The shared-polygon flag counts distinct area names, not duplicate postcode rows.

**Points.** A point guard refuses water bodies (the shapefile's own `village_hq`), polygons over 50 km² and polygons
that fill under 30% of their box; they are listed for a manual point. The expected error is a p90 (0.949·R for a disc,
or the bounding box's RMS half-diagonal when larger) so it is comparable with the p90 spread of pins later. The band
verdict is by band: consistent when the seeded band is the band at the km or at km × allowance; adjacent when within
the point's own error (floor 250 m) of an edge; otherwise suspect, with fuzzy ≥ 0.85 treated as clean. Flips are
counted only for suspect-band rows; water and non-road areas never enter the re-band file.

**Writes.** `centroid_source_ref` = `objectid:PCODE[#method:score]`; counters branch on the rows the UPDATE
reports; both corridor writers take `pg_advisory_xact_lock(hashtext('delivery_corridor_apply'))`; `area_kind` has an
`area_kind_source` (`pattern` | `admin`) and the import classifies all 5,805 gazetteer rows without ever touching an
admin's kind; "Estate" is a neighbourhood. The corridor dry run reads RFC 4180 (one shared grammar for every CSV in
the shop, `packages/shared/src/csv.ts`), refuses duplicate slugs, apply requires a reason and is compare-and-set on
the dry run's `from` values (nothing lands if any row moved), and `RevertCorridorBatchUseCase` inverts an audited
batch in one action.

**Measurement.** `RecordDeliveryUseCase` now mirrors every attempt onto the quote capture: `dispatched_at` from the
dispatch, `delivered_at`, `actual_minutes` (dispatch → handover), `first_attempt_success` (false on a failed first
attempt). The capture also records `distance_source`, so the two populations can be separated when the switch flips.
The report windows minutes and attempts on the delivery date, measures the model-priced share against own-rider
quotes, shows the signed median, and the table has a `created_at` index. MODEL.md states the comparison basis.

**Privacy.** The assistant archive redacts coordinates and map links.

**Data as data.** `data/geo/MANIFEST.csv` (vintage and checksum per file; nothing in code pins a checksum),
`district-lineage.csv` (now with Kisoko and Bughendera as proposed), `district-name-variants.csv`,
`area-kind-rules.csv`, `acceptance-areas.csv`; `createLineage(rows, variants)` builds the family function from data;
every run writes `geo_data_source_run` (source, vintage, md5, rows read/matched/written, parameters, mode, who).

## What changed in the spec (addendum §16 on PR #115)

The Phase B design was corrected on the reviewers' evidence rather than built as written: rider handover bound to
the dispatch by one button in one message, not by a 5 km radius; the customer ask confirms "deliver here?" before
anything is stored and never writes a pin to the saved address without a second tap; a "Remove pin" on the saved
address and a stated retention on the privacy page; the WhatsApp location message intercepted before the assistant
composes (today it is answered with the shop's address), with E.164 matching, open-status filters, forwarded-pin
handling, a rider identity table and an interactive-message port; fee quotes from a pin only through the one quoting
service with the model never authoring the sentence; the four metrics redefined with denominators and windows;
attribution of the `distance_source` flip by paired replay on `centroid_km` and a corridor holdback under a fixed
ladder; pooling top-down (tier → corridor → area; dayparts before hours; no geohash layer inside Kampala); a
per-corridor detour allowance; post-2016 splits resolved through village evidence; the district count carried as two
labelled numbers (`ec-2026` 146, `molg-2025` 150) with the EC Annual Bulletin as the primary; the rider card reordered
(phone, area and stage in the customer's words, amount to collect, map link, directions) and Plus Codes dropped from
it; ladder rungs in thousands; `stops_on_trip` on the dispatch now, not later.

## What the board did not change (and why)

- The ±2 km tolerance was replaced, not tuned: the reviewers disagreed on the number and agreed on the principle
  (the point's own error is the only non-invented tolerance).
- `area_kind` stays a column the quote path does not yet read: the metro set's institutions are priced as their
  parish by design, and the rider-card instruction that would use it is Phase B. It is now data with provenance.
- Matching thresholds stay parameters of the run (recorded in `geo_data_source_run.params`), not registry keys: a bad
  value cannot change a fee, and a person runs the import.
- The quote path's eight redundant config reads were pre-existing; fixed in the same PR with a five-second
  per-process snapshot that publish and revert clear. The three timings the optimisation reviewer asked for (hit/miss
  split, the report's EXPLAIN, the import's two phases) are still worth taking once the import has run in production.
- Also implemented after the board: both origin readers prefer the primary hub; `area_kind` reserve/water/island is
  honoured by the quote path (never serviceable for a door); village-name matching (`#village`) for areas that are a
  parish's reference village; per-corridor detour allowances as a data file; a 5,000-row cap on the Corridor file.

## Data vintage, as the shop now records it

| Source | Vintage | Authoritative for | Not for |
|---|---|---|---|
| UBOS parish polygons (`ubos-parishes-2016`) | 2016 | geometry only, labelled by year | names, districts after 2016, splits |
| Ministry of ICT postcodes (`ict-postcodes-2019`) | April 2019 draft, never finalised | the shop's key space | current names or counts |
| EC voter register summary | 2020 | station names | the 2026 register (50,739 stations vs 34,684) |
| EC structure via the owner's selector package | 2024 demarcation | electoral units and codes | district counts (222 ≠ 146); provenance unverified |
| EC Annual Bulletin 2025–2026 | 2025 | **146 districts and cities** (electoral) | the Local Government count (150 incl. the four of July 2025) |
| OSM / GeoNames | live, dated per extract | buildings, POIs, labels | boundaries below district |
| The shop's deliveries | live | where customers actually are | official names |

Rule: points by precedence (handover > delivered pins > manual > polygon, year-labelled); names and counts by the
newest authoritative source (Gazette > EC lists > UBOS > 2019 postcodes > scraped packages; news is a prompt, never a
source); every stored fact carries `(source, vintage)`; a count is never quoted without its label.
