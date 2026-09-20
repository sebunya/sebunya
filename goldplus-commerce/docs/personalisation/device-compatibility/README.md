# Battery → phone compatibility: activation proposal (nothing applied)

**Correction.** An earlier version of this folder proposed a CLI import with
`confidence=declared`. That bypassed the shop's own review workflow and is
withdrawn. The battery module already has the right model, and its admin
importer (`/admin/batteries` → Import → type **Compatibility**) was built for
exactly this workbook sheet: its column auto-mapping matches all 11 columns.

## How a claim becomes customer-visible (existing code, `CompatibilityWorkflow.ts`)
A fit is shown only when ALL hold: claim `workflow_status = ACTIVE`; battery
lifecycle `ACTIVE`; product approved+active; and evidence is
- `PACKAGE_VERIFIED` / `FIT_TESTED` / `VERIFIED_EXACT` → "Verified fit, in stock / out of stock"
- `CONDITIONAL` → "Fits with a condition"
- `SUPPLIER_LISTED` → shown ONLY if the finder setting *show awaiting verification* is on, as **"Listed by the supplier, not yet checked by us"** (never "fits your phone").

An import always stages `DRAFT` + `SUPPLIER_LISTED`. **Imports never publish.**
Note: all 80 live batteries are currently lifecycle `REVIEW`, so no fit can be
public until batteries are activated too — a second, separate gate.

## What the importer's own rules do with the 102 claims (`evidence-ledger.csv`)
| Outcome | Rows | Meaning |
|---|---|---|
| Stage, then review for verification | 34 | two independent supplier sources agree, exact model number, battery is a live product |
| Stage only | 23 | single weak source (inventory name / poster); needs package or fit evidence |
| Held by the importer | 12 | compound battery line or a recorded conflict — split/resolve first |
| Not importable | 33 | 18 rows have no battery code in the source at all (14 iPhone lines + 4); 15 name a battery that is not a live product (EB-BA505ABU, EB-BA217ABY, EB-BA207ABU, BLP727, BLP681, HQ-50S, BL-39LT probable) |

`evidence-ledger.csv` is row-level: claim id, battery, device, exact model,
the workbook's evidence wording, source and URL (as supplied — nothing added),
the importer outcome and the proposal. Produced by running
`normaliseImportRow` against the live battery codes and aliases (read-only).

## Recommended evidence threshold
- **Internal staging (safe now):** upload `compatibility-map-for-admin-import.csv`, run the dry run, apply. Result: DRAFT claims, invisible to customers.
- **"Verified fit":** the battery's printed code photographed on the packaging/label and matching the claim (`PACKAGE_VERIFIED`) is enough for the 34; a physical fit test (`FIT_TESTED`) is needed only where the workbook records a conflict or a variant question. A fit test proves it seats and powers on — not capacity or longevity.
- **Supplier-listed wording in public:** optional, one switch, exact copy above.

## The two decisions
1. Stage all importable rows as DRAFT (invisible)? — reversible: archive the session's claims.
2. Separately, later: which verified claims to activate, and whether to show supplier-listed ones with the wording above.

## Native dry run (2026-09-20, production copy, isolated)
`battery-source-import.ts … COMPATIBILITY` — the same upload → map → dry run the admin screen performs — accepted the CSV, produced a 102-row session, and **left `devices` and `product_device_compatibility` at 0 rows**: "Nothing was approved or applied." Its error list matched this ledger except row 66 (BL-30RT), which the real resolver matched to live battery `30RT`; the ledger follows the real run (34 / 23 / 12 / 33 = 102).

## Proposed first verified subset
None qualifies today: not one claim has packaging or fit evidence on file. The shortest path is two batteries — **BL-49FT (7 phones) and BL-49GX (5 phones)**: a label photo and a packaging photo of each could verify 12 fits. `evidence-request-sheet.md` is ordered that way. Verified claims publish one by one; nothing waits for the other 90.

## Guard added in code
`DrizzleDeviceRepository.compatibleProducts` / `accessorySuggestions` read this table with no publication filter. They have no callers today, but the first caller would have shown every staged claim as a fit. Both now require a published claim, checked evidence and an active battery — verified on real PostgreSQL with a staged DRAFT row (returns nothing).

## The 14 iPhone lines
Their source rows have no battery code — those batteries are identified by phone name. The live catalogue codes them `IP X`, `IP XR`, `IP 11`…, so they can be staged simply by putting that code in the *Battery Reference* column. That is a data decision for the owner (it asserts "the IP X battery is the iPhone X battery"), so the file leaves them blank.
