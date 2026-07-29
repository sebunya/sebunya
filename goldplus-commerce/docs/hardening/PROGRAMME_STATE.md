# GoldPlus hardening — programme state

The machine-readable source is `PROGRAMME_STATE.json`. This file explains it.

**Why this exists:** the previous session's worktree became unreachable and its
only continuation state was the conversation. That state was lost. The repository
is now the memory.

## Where the programme is

| | |
|---|---|
| Branch | `claude/amazon-grade-module-hardening-20260729` |
| Base | `5e6d4ea` |
| Migration ceiling | `0057` |
| Wave | 1 |
| Clean-tree suite | 4547 passed, 0 failed, 11 skipped |

## Modules closed so far

Each carries a committed fix, tests, and — where the claim is about persistence
or concurrency — a proof against a real PostgreSQL 16 or a real `redis-server`.

authentication · authorization · audit · health/liveness/readiness ·
database resilience · outbox · webhooks & payments · inventory · checkout ·
notification outbound gating · loyalty ledger integrity

## What is still open

**H-01 — inventory constraint not yet validated.** `products_reserved_within_stock`
is `NOT VALID` by design: a pre-existing violation is a commercial problem about
real customer orders, and a migration is not entitled to settle it by refusing to
deploy or by quietly changing data. `scripts/db/inventory-constraint-readiness.sh`
must reach `convalidated = true` against production data before Wave 1 ships.

**H-02 — cart object-level authorization.** Cart routes have not been audited.
The concern is a caller reading or mutating another cart by knowing its id.

**H-03 — no single outbound-delivery policy.** Each provider interprets the
environment flags itself. The gates are currently correct in both providers, but
correctness repeated per-provider is a defect waiting for the third provider.

## What this environment cannot do

Stated plainly because a plan that pretends otherwise is worthless:

- **No macOS host.** Rail B validation requires real `/bin/bash` 3.2.57 on Darwin.
- **No production access.** No `ssh goldplus-prod`, no production credentials.
- **No Docker.** Exact-image builds and Playwright-against-image cannot run here.
- **No human approval marker.** An agent must never create one.

Everything that does not depend on those is in scope here and is being done.

## Resuming

Read `PROGRAMME_STATE.json`, take `nextExactAction`, and continue. Verify the
remote head is a descendant of `currentHead` before editing; never move the branch
backwards.
