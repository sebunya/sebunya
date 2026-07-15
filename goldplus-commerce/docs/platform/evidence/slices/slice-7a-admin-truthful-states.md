# Slice 7A — Admin truthful states (no fabricated records)

Date: 2026-07-15 · Branch: `phase-2-measurement-control-tower-completion`

## Defects repaired

Four admin pages fell back to hardcoded SAMPLE data on fetch failure, rendering
fabricated quotes/support-tickets/campaigns/payments as real-looking records
(campaigns had no backing API at all, so it ALWAYS showed invented campaigns).
Two more pages (inventory, pricing) swallowed fetch failures silently, showing an
empty table indistinguishable from "no stock".

## Changes

- `admin/campaigns`: fallback `[]` + explicit **not-configured** state ("No campaign
  engine is wired to this console").
- `admin/quotes`, `admin/support`, `admin/payments`: fallback `[]` + truthful
  "live data unavailable — no sample data is shown" notices.
- `admin/inventory`, `admin/pricing`: now render the unavailable notice on fetch
  failure instead of a silent empty table.
- Regression contract `Slice07AdminTruthfulStates.test.ts` (3): no admin page may
  reference `SAMPLE_*` value constants; no "sample … shown until" copy; every
  `tryFetchAdminList`/`loadFailed` page must render its unavailable state.

Deny-by-default protection for all 54 admin pages remains enforced by the
Slice 8-B1 sweep. Remaining Slice 7 depth (per-page keyboard/mobile verification)
is owned by the Slice 13 accessibility/responsive matrix to avoid double-tracking.
