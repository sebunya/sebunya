# Device compatibility — proposed import (NOT applied)

**Why the finder shows no phones in production:** `devices`, `device_brands` and
`product_device_compatibility` are empty (0 rows). The 80 `battery_profiles` and
204 `battery_aliases` describe BATTERIES (codes and their alternative spellings);
an alias proves two names mean the same battery, not that it fits a phone.

**Source:** `GoldPlus_Battery_Catalogue_Audit_and_Mapping_2026-08-26.xlsx`, sheet
"02 Compatibility Map": 102 battery→phone claims. The workbook itself marks all
85 stock lines `Publish Status = HOLD` and every claim "Exact only after model
confirmation".

| Evidence status in the workbook | Claims | Treatment |
|---|---|---|
| Supplier cross-check, battery code matches a LIVE SKU, exact model number given | **34** (34 phones, 11 batteries) | proposed here, `confidence=declared`, source named per row |
| Supplier cross-check, no matching live SKU (EB-BA505ABU, EB-BA217ABY, BLP727, HQ-50S) | 12 | held — the battery is not a live product |
| Inventory-name / poster / supplier-only / ambiguous / conflicting | 56 | held — not strong enough for a customer-facing fit claim |

Nothing is `verified`: a supplier's list is a declaration, not our own check.
No charger, cable or case compatibility is derived from battery data.

**Files:** `proposed-devices.csv`, `proposed-compatibility.csv` (validated by the
importer's own validator in `tests/unit/ProposedDeviceCompatibilityImport.test.ts`).

**To apply (owner approval required; rehearse on the clone first):**
1. `tsx apps/api/src/scripts/import-devices.ts proposed-devices.csv` (dry run) then `--apply` — rerun-safe, existing slugs skipped.
2. `tsx apps/api/src/scripts/import-device-compatibility.ts proposed-compatibility.csv <actorId>` — whole-file validation, one transaction.

**The one business question:** are you content for these 34 to show as
supplier-declared fits ("awaiting verification" styling), or do you want a
physical check of each battery first so they can be marked verified?
