# Module Automation A5 — complete acceptance evidence

Date: 2026-07-19 (Africa/Kampala)

Base: clean local/origin A4 commit `f628b6d0b9cbd31193506f3940429bdc0482de24` on
`phase-2-measurement-control-tower-completion`.

## Boundary and decision

A5 adds one self-cleaning acceptance proof script. It changes no domain, application, persistence, API, UI, RBAC,
audit, provider, outbox, scheduler, schema, migration, checkout, payment, consent, Customer DNA, NBA, Decision
Intelligence, fulfilment, inventory, or deployment implementation. A4 supplied the final missing operating layer;
A5 verifies the complete A1–A4 system through real PostgreSQL, protected HTTP, the built Astro application, and a
controlled in-process provider adapter. No real provider is configured or called.

Migration decision: `NONE`. Migrations remain `0000`–`0040`.

Automation classification: `SOURCE_COMPLETE_NOT_DEPLOYED`. This is local acceptance evidence and is not
`LIVE_VERIFIED` or a deployment claim.

## Integrated lifecycle proof

`automation-acceptance-proof.ts` refuses production, compiles, returns non-zero on assertion failure, cleans all
scratch rows in `finally`, closes the shared database handle, and prints one deterministic final JSON verdict.
Against PostgreSQL 16.14 it proved:

- immutable definition version creation, submission, approval and activation;
- a real supported `OrderPlaced` domain trigger with concurrent planners producing one plan and one duplicate;
- real Customer DNA audience resolution (`ELIGIBLE`) and two persisted passing condition-evidence entries;
- an internal `NO_ACTION` ending `INTERNAL_SUCCESS` with zero provider calls;
- an external dry run ending `DRY_RUN` with zero attempts and zero provider calls;
- two external action creators producing one winner, one duplicate, one action, one cap reservation and one existing-outbox intent;
- the outbox processor and notification router invoking the controlled fake adapter exactly once;
- `SENT` only after one positive `A5_FAKE_ACCEPTED` attempt record, and SENT replay denial;
- pause preventing a new trigger match and resume restoring planning eligibility;
- persistence-backed admin execution detail, overview/provider readiness, and approval/pause/resume audit rows;
- zero duplicate trigger keys, duplicate action keys, orphan rows, real-provider calls, and proof residue.

Final verdict: `PASS` with `fakeProviderCalls=1`, `realProviderCalls=0`, `proofResidue=0`.

## Specialized safety proofs

The A3 proofs were rerun against the same PostgreSQL instance and all returned `PASS`:

- planning: native object/array JSONB, one-layer legacy compatibility, malformed rejection, one plan/one duplicate,
  ineligible/no-profile evidence, zero provider calls;
- eligibility: two racers created one reservation and one exact `FREQUENCY_CAPPED` suppression; replay reused the slot;
- action: two creators produced one action, one cap and one linked existing-outbox no-send intent;
- provider/replay: ambiguous attempt became non-replayable `OUTCOME_UNKNOWN`, reconciliation succeeded, known failure
  eight became `DEAD_LETTERED`, replay reused the cap, and SENT replay was blocked;
- execution: all 13 prohibited states had explicit adapter counters of zero; QUEUED and PROCESSING remained distinct
  from SENT; INTERNAL_SUCCESS was independent; positive, definitive-failure, ambiguity, crash/lease recovery,
  reconciliation and gate-revalidated replay were evidenced; every orphan/duplicate/residue count was zero;
- control room: logged-out protection, exact lifecycle/RBAC, stale conflict, dry-run, evidence, audit, aggregates,
  separate reconciliation and zero transport/residue passed through the protected Hono app.

The controlled adapters made only the calls required by their positive/failure/ambiguity scenarios. They performed
no network transport and no customer communication.

## Migration and production-shaped proof

- Fresh migration replay `0000`–`0040`: 41 migration rows, cap-reservation table present, three foreign keys, three
  indexes, zero orphan cap rows.
- Populated `0039`→`0040` upgrade: a definition, version, execution and action were inserted before 0040; all four
  lineages remained after the upgrade; the same three foreign keys/indexes existed and orphan caps were zero.
- Built Astro + API + Chromium desktop: the protected Automation control room rendered a definition created through
  the real API in scratch PostgreSQL, its real empty-execution state and truthful OUTCOME_UNKNOWN language; fixture
  cleanup and database closure completed. Result: 1/1 passed.

## Gates

- workspace typecheck: PASS;
- API and Astro production builds: PASS;
- architecture: 2 files / 10 tests PASS;
- secret scan: 1,123 source/config files PASS without printing values;
- changed-path lint: PASS with zero errors (warnings only);
- repository-wide lint: `PRE-EXISTING UNRELATED BASELINE ERROR` at
  `apps/api/src/application/ports/ICustomerDnaRepository.ts:6`; no A5 error;
- clean-commit full suite: 191 files / 4,020 tests PASS;
- `git diff --check`: PASS.

No production deployment, migration, provider transport, consent lifecycle, identity provisioning, or customer
communication occurred.
