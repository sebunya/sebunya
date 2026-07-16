# Slice 14E — Authenticated customer and admin acceptance (local stack)

Date: 2026-07-16 · API under tsx + PostgreSQL 16, migrated 0000→0028.
Identities: throwaway local fixtures (`acceptance-owner@fixture.local` with all
permissions via `apps/api/src/scripts/acceptance-bootstrap.ts` — refuses to run in
production; `acceptance-customer@fixture.local` with none). No credentials logged.

## Admin — authenticated success AND unauthorized denial

| Module | Result |
|---|---|
| Owner login `/auth/admin/login` | token issued (permission-bearing users only) |
| Delivery zones | PUT 200 → row visible → DELETE 200; **audited** (`DELIVERY_ZONE_UPSERTED/DELETED`) |
| Demand queue | GET lists aggregated row; PATCH → `reviewing`; invalid status → 400; **audited** |
| Compatibility | self-mapping rejected (`SELF_MAPPING`); conditional+note declared → 200; **PDP serves it** ("Works with conditions · Charges at full speed only with a 30W adapter") |
| Loyalty | GET config shows `active:false, envFlag:false` (dormant truth); PUT 200 after repairing a 14E-found defect (audit `entityId:'singleton'` violated the uuid column — now a fixed singleton uuid); invalid rate → `INVALID_RATE`; **audited** (`LOYALTY_CONFIG_SAVED`) |
| Payment reconciliation | `healthy:true, checkedOrders:2` |
| Lifecycle/NBA | totals all zero — truthful (no registered-customer orders in fixture) |
| Recommendations | admin rules GET 200 |
| Support inbox | public create validates (≥20-char description, valid email, Ugandan phone — probed and satisfied); inbox SLA-annotated (`overdue:false`); PATCH → `in-progress` + assignee `Grace`; repeat transition → `ILLEGAL_TRANSITION`; **audited** (`SUPPORT_TICKET_UPDATED`) |
| Unauthorized denial | permissionless customer token on `/admin/delivery-zones` → **403** |

## Customer — authenticated + public flows

| Flow | Result |
|---|---|
| Customer login `/auth/login` | session token issued |
| `/account/loyalty` | `programmeActive:false`, balance 0 — dormant truth |
| Storefront/products/suggest, forged-price checkout, Uganda fee, idempotent replay, zero-result demand, lockout 429 | verified in the Slice 10-E/0B battery (same stack) |
| PDP compatibility | serves only the admin-declared verdict with its condition note |

## Defects found and repaired by this phase

1. Loyalty config audit `entityId: 'singleton'` → 500 (uuid column). Fixed with a
   fixed singleton uuid constant. (The only non-uuid audit entity id in the codebase.)

Environment notes: Redis absent → BullMQ adapters log their safe local dry-run
fallback (designed behaviour); no provider calls occurred.
