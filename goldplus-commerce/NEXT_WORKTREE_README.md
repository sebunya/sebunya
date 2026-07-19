# NEXT WORKTREE — Fulfilment Operations resume

Branch: `phase-2-measurement-control-tower-completion`
Current head: `fa1c41e` (= origin). Clean tree. Full suite 178 files / 3,891 tests; architecture 10/10.
Migrations proven through **0033** (fresh `0000→0033` + populated-upgrade on `launchcheck`).

## Completed this cycle
- **F1** team queues & ownership — migration `0032` (teams, members, team_id on task).
- **F2** idempotent SLA escalation — migration `0033` (sla_policy_version, is_lead,
  fulfilment_sla_events); evaluator with real-PostgreSQL concurrency proof.

## NEXT sub-slice: F3 — packing, partial fulfilment and backorders

Exact scope (extend the fulfilment task + a new line-quantity record; do NOT create a
second fulfilment/inventory system):
- New migration `0034` (additive): `fulfilment_line_items` or extend the task's items with
  per-line quantities `ordered / reserved / packed / dispatched / delivered / backordered /
  cancelled`; a `fulfilment_packing` record (packer id, notes, package count/reference,
  checklist, shortage/damage/hold reason, started_at/completed_at).
- Domain invariants (pure, heavily tested): `packed ≤ reserved`, `dispatched ≤ packed`,
  `delivered ≤ dispatched`, `fulfilled + backordered + cancelled = ordered`, no negatives,
  idempotent commands.
- Use cases: StartPacking, RecordPackedQuantities (partial), BackorderRemainder,
  CancelRemainder, ReleaseUnusedReservation (reuse the F(section 12) ReleaseInventory),
  CompletePacking. Do NOT mark a partial order fully packed/fulfilled.
- Routes under `/admin/fulfilment/:id/packing` (orders.manage; audited). Admin page section.
- Tests: invariants, partial, backorder remainder, cancel remainder, idempotency,
  release-unused; migration fresh + populated proofs.
- Commit message exactly: `Module Fulfilment F3: add packing partial fulfilment and backorders`.

Then F4 (dispatch tracking + single stock consumption — choose PACKED or
READY_FOR_DISPATCH as the one consumption point; prove it consumes once) and F5 (delivery
confirmation DELIVERED/DELIVERY_FAILED/RESCHEDULED/RETURN_TO_ORIGIN/PARTIALLY_DELIVERED +
fulfilment reporting). Then continue through the absolute completion matrix.

## Resume commands
```
cd goldplus-clean-continuation/phase-2-measurement-control-tower-completion-20260715/goldplus-commerce
git fetch origin phase-2-measurement-control-tower-completion && git status --short   # expect clean at fa1c41e
# local PostgreSQL 16 helper for migration/concurrency proofs:
#   su -s /bin/bash postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/gpdata -o '-p 55432 -k /var/lib/postgresql' start"
#   DB launchcheck (populated) is at migration ledger through 0033.
```

Production deploy/UAT remain EXTERNAL_BLOCKED: no `ssh goldplus-prod` binary in this
container; nothing is LIVE_VERIFIED. Do not create operator approval markers.
