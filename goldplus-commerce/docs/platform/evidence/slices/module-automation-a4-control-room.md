# Module Automation A4 — operations control room evidence

Date: 2026-07-19 (Africa/Kampala)

Base: clean local/origin `ebccac4b88d2a9b4dee4c5b5a54ebbbe89f19d34` on `phase-2-measurement-control-tower-completion`.

## Boundary and decision

A4 extends the existing admin composition and the A1–A3 Automation model. It adds the exact `automation.read`,
`automation.create`, `automation.manage`, `automation.approve`, `automation.execute`, `automation.replay`, and separately
privileged `automation.reconcile` permissions; one operations port/use case/Drizzle read-write adapter; thin protected
Hono/Zod routes; shared audit writes; and real Astro definition/execution pages. It reuses the existing Automation tables,
Customer DNA audience reader, action executor, outbox, replay, reconciliation, Registry, auth/RBAC and audit systems.

Migration decision: `NONE`. Migrations remain `0000`–`0040`. No provider adapter/router, outbox, scheduler, worker,
consent, Customer DNA, NBA, Decision Intelligence, fulfilment, inventory or deployment implementation changed.

## Truth and safety

- Dry-run persists audience/condition/provider-readiness evidence and `DRY_RUN` action state with zero attempted provider calls.
- Manual external execution can only create the existing outbox intent; no API route owns provider transport.
- SENT, attempt count, outbox intent/status, suppression reason, cap reservation and event lineage are read from persistence.
- OUTCOME_UNKNOWN replay is denied. Reconciliation requires `automation.reconcile`, actor, reason and a bounded evidence
  reference; the shared audit record and Automation timeline preserve previous/new state, time and correlation ID.
- Overview counts definitions, approvals, execution/action states, exact suppression reasons, queue age, planning/execution
  durations, next scheduled run and provider attempt evidence. No customer identifier is a metric label.
- Astro renders loading, empty, denied, error, stale conflict, successful mutation, approval, eligibility/suppression,
  delivery, retry/DLQ and ambiguous-outcome states. It has no sample executions, static provider status or fake metrics.

## Proof

`automation-control-room-proof.ts` ran against PostgreSQL 16.14 through the protected Hono app and finished `PASS`:

- logged-out overview `401`;
- draft, immutable version, submit, approve, reject, activate, pause and resume succeeded;
- stale version returned `STALE_VERSION`;
- dry-run persisted `DRY_RUN`, attempt count zero and provider-call count zero;
- execution detail returned one attempted ambiguous lineage and exact `NO_CONSENT` suppression;
- unresolved ambiguous replay returned `REPLAY_NOT_ALLOWED`;
- missing evidence returned `RECONCILIATION_EVIDENCE_REQUIRED`;
- evidence-reference reconciliation produced FAILED without a new attempt and preserved correlation;
- 15 shared audit rows were observed;
- overview/definition/execution reads returned live scratch persistence;
- provider transport calls were zero;
- proof residue was zero.

Focused Automation plus architecture: 7 files / 71 tests passed. Workspace typecheck, API/Astro build, secret scan,
changed-path lint (zero errors), and `git diff --check` passed. Repository-wide lint remains
`PRE-EXISTING UNRELATED BASELINE ERROR` at `apps/api/src/application/ports/ICustomerDnaRepository.ts:6`; A4 adds no lint error.
The clean-tree repository suite after the A4 commit passed 191 files / 4,020 tests.

Chromium desktop browser proof passed against the built Astro server and the API backed by PostgreSQL 16.14. The
authenticated page rendered the real scratch definition, real empty-execution state, persistence-backed provider-evidence
statement and OUTCOME_UNKNOWN glossary; its definition, audit, RBAC and user fixtures were deleted after the test.

Status: `SOURCE_PARTIAL` until A5 production-shaped end-to-end acceptance passes. No production deployment or live verification is claimed.
