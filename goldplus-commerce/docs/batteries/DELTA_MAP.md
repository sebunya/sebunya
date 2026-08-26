# Battery catalogue, inventory and finder: delta map and decisions

Audit date: 2026-08-26. Branch `deploy/price-floor-145k`, start HEAD `b28f1f18`.
Production facts at audit: 8 products, 3 catalogue categories (`other`,
`power-devices`, `sound-devices`), `devices` 0 rows, `product_device_compatibility`
0 rows, `seo_battery_compat` 0 rows, `seo_battery_finder_events` 2 rows, migration
head `0124_seo_intel_source_state`.

## What already existed (preserved)

| Area | Found | Verdict |
|---|---|---|
| Device catalogue `devices` (0070) | flat brand + model, aliases, normalisation, slug, popularity; no HTTP surface, no UI | **Extended** with brand/series FKs, exact model number, variant, status, display order, merge target |
| `product_device_compatibility` (0070) | proper M:N, fit type, confidence, DB-enforced verified evidence; only reachable from a CLI script | **Extended** into the compatibility workflow (evidence status, workflow status, evidence asset, public condition, review and publication fields) |
| `seo_battery_compat` + `/seo/battery-finder` + `/admin/seo/battery-compatibility` (0119) | free-text brand/model rows, honest statuses, an orphaned public page | **Kept working, marked legacy.** The public finder and the product page now read the canonical model. Its admin page links operators to the Batteries module |
| `seo_battery_finder_events` | query/matched only; brand/model/click columns never written | Superseded by `battery_finder_events`; the legacy endpoint still writes it |
| `search_demand_signals` + `/admin/search-demand` | zero-result shop searches | Untouched; battery demand has its own richer events and requests |
| Product↔product compatibility (Slice 5) | `/admin/compatibility`, PDP "Verified compatibility" | Untouched (accessory pairing, not batteries) |
| PIM staged importer (`pim_import_*`) | product catalogue only, JSON rows pasted with a SHA-256, no spreadsheet upload | **Mirrored** by `battery_import_*` (same lifecycle, four-eyes approval, versioning, error report, rollback) with real `.xlsx`/`.csv` upload, column mapping templates and per-type validation. The product importer is left as it is |
| Media library (Wave 2B) | checksum-deduplicated uploads, variants, usages | **Reused** for catalogue and evidence images |
| Inventory | `products.stock_quantity` + row-locked `AdjustStockUseCase`; no ledger, no locations, no receipts, no counts | **Extended**: `inventory_movements` ledger written in the same transaction as the stock change; `stock_locations`; receipts; counts |
| Product attributes | per-category typed specs (`attributes`) | Battery specs live on `battery_profiles` (typed columns), not in free-text attributes |
| Nav "Phone batteries" finder | form `action="/shop?category=power&q=battery"` with input `model`: a GET form drops the action's query, so the typed phone landed on the unfiltered shop | Form now posts to `/battery-finder` with input `q`; chips point at the finder brand pages. Markup and style untouched (owner's module) |
| Product page | shows compatible *products* only; sale price ignored the price floor (`salePriceUgx` called with two arguments) | Battery block added (specs, compatible devices, model check, buying-for context); floor argument fixed |

No product variants exist in this codebase, so the product row IS the sellable
SKU: one product, one price, one stock balance, one `battery_profiles` row, many
compatibility rows.

## Decisions

1. **Canonical model** = `device_brands` → `device_series` → `devices` (exact model
   number and variant separate from the marketing name) ↔ `product_device_compatibility`
   ↔ `products` + `battery_profiles` + `battery_aliases`.
2. **Publication is derived, never a flag on its own.** A compatibility row is public
   only when `workflow_status = 'ACTIVE'`, its evidence status is not `REJECTED`,
   the battery profile is `ACTIVE` and the product is approved. Public copy states
   the evidence level (verified, conditional, awaiting verification) and the
   stock state separately.
3. **Maker and checker are different people.** The actor who created or submitted a
   claim cannot verify it; the actor who verified it may publish it. Enforced in
   the use case, not the UI.
4. **Compound and conflicting source lines are held**, never split by guesswork.
   `HOLD_COMPOUND` / `HOLD_CONFLICT` rows stay in the import until an operator
   resolves them; the ten compound codes and six named conflicts are regression
   fixtures.
5. **No invented facts.** Blank workbook cells stay blank. No quantity, price,
   barcode or specification is created by the import. The readiness checklist
   states exactly what is missing.
6. **Price floor.** The owner's storefront floor (UGX 145,000, 2026-08-17) is a
   publication check: a battery priced below it cannot become ACTIVE. The floor is
   one named constant (`STOREFRONT_PRICE_FLOOR_UGX`) until an admin module owns it.
7. **Stock writes go through the ledger.** Opening stock, receipts, counts and
   corrections all create `inventory_movements` rows inside the same transaction
   as the row-locked stock update; the existing negative-stock and reserved-stock
   refusals apply.
8. **Device context is web-side.** The selected device travels as a cookie
   (`gp_battery_device`: slug + label, no PII) from finder → product page → cart →
   checkout; each battery line is checked against it and a mismatch is shown, not
   silently dropped. Cart lines carry no device (the cart schema has no metadata
   column and one line per product per cart).
9. **Finder copy, no-result copy, brand ordering and instructional content** are a
   `battery_finder_config` JSONB singleton (same shape as `nav_config`), seeded at
   boot, edited at `/admin/batteries/finder-settings`.
10. **Search ranking**: exact barcode or canonical code, exact supplier code, exact
    device model number, exact device marketing name, exact alias, prefix match,
    then a bounded trigram suggestion that only ever *suggests* a device or code.

## Permissions added

`batteries.read`, `batteries.catalogue.manage`, `batteries.devices.manage`,
`batteries.compatibility.propose`, `batteries.compatibility.verify`,
`batteries.publish`, `batteries.demand.manage`. Stock uses the existing
`inventory.read` / `inventory.adjust`; unit costs on receipts need
`product_costs.manage`; imports use the existing `pim.*` rights.

## Source files

- `BATTERIES (2).xlsx` (sha256 `32c2c7ee…77437`): 85 lines, `NO | CATEGORY | ITEM`.
- `GoldPlus_Battery_Catalogue_Audit_and_Mapping_2026-08-26.xlsx` (sha256
  `1d54c01f…f1f4a`): Summary, 00 Source Inventory, 01 Battery Master (85 rows),
  02 Compatibility Map (102 claims), 03 Data Quality, 04 Price Stock (blank),
  05 Range Gaps.
- The compatibility poster image was not present in the workspace. The only
  battery artwork found (`4.18-goldplus BATTERY.pdf`) is a BL-20JT blister-pack
  design, not the poster. Poster-derived claims are imported exactly as the
  workbook states them (`GoldPlus supplier poster` as the evidence source).
