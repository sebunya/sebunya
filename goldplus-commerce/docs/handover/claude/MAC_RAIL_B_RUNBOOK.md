# Mac Rail B runbook

Deterministic MacBook-local / Hetzner-remote execution package. Machine-readable twin:
`MAC_RAIL_B_RUNBOOK.json`.

Rail A completed everything reachable from a cloud Linux environment. Rail B produces the
release-scope inputs that **only** the Mac can generate — exact images, production-shaped data and
exact-image browser journeys — and then deploys.

## Rail A result

| | |
|---|---|
| Executable candidate | `232e2903410e317d06e1416f67ed5f85904eb693` (**unchanged**) |
| Executable→package diff | 14 paths, **0 runtime source** (6 tooling, 4 test, 3 docs, 1 evidence) |
| Provisional scope | `provisionalRailAScopeSha256` — **not** a final release scope |

## Branch semantics

The local branch name is **evidence only**. It is never required to equal the target branch, so
your side branch works with no renaming and no script editing.

| Concept | Meaning |
|---|---|
| `WORKTREE_BRANCH` | local branch name; recorded, never enforced |
| `TARGET_BRANCH` | remote branch defining the baseline (default `phase-2-measurement-control-tower-completion`; override with `--target-branch` or `RAIL_B_TARGET_BRANCH`) |
| `EXPECTED_REMOTE_HEAD` | `origin/TARGET_BRANCH` at run start, re-checked before finalisation |

**Accepted:** a clean side branch whose `HEAD` equals `origin/TARGET_BRANCH`.
**Refused:** `WORKTREE_NOT_CLEAN`, `LOCAL_HEAD_NOT_AT_TARGET_REMOTE_HEAD`,
`LOCAL_HISTORY_DIVERGED_FROM_TARGET`, `TARGET_BRANCH_MOVED_DURING_RAIL_B`,
`NON_FAST_FORWARD_FINALISATION`, `RAIL_A_EXECUTABLE_BOUNDARY_INVALID`.

Finalisation pushes with `git push origin HEAD:refs/heads/${TARGET_BRANCH}` — never forced.

## Gate states are machine-enforced

Every gate records exactly one of `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, `NOT_APPLICABLE`, with
`gateId`, `startedAt`, `finishedAt`, `command`, `exitCode`, `evidencePath` and `reason`.

`PASS` is reachable **only** when a command actually ran and exited zero. Every dry-run step records
`NOT_RUN`, so a dry run cannot report success — verified: **0 `PASS` lines** in dry-run output. A
final result is impossible while any mandatory gate is `FAIL`, `BLOCKED` or `NOT_RUN`.

## Playwright classification

Rail A produced **`COMPILED_SERVICE_PLAYWRIGHT_SUBSET_PASSED`** — 14/14 journeys on chromium
desktop and mobile against the live API catalogue resolver, plus 11 resolver tests, but against
**compiled services, not exact images**.

**`EXACT_IMAGE_PLAYWRIGHT_ACCEPTANCE_PASSED`** is reserved for the Mac run with the exact API and
web production images, isolated PostgreSQL and Redis, the complete image-backed journey set, and
proven zero provider/customer side effects. The final scope binds the Mac evidence and never
substitutes the Rail A subset.

## Scripts

| Script | Purpose |
|---|---|
| `mac-rail-b-preapproval.sh [--dry-run] [--target-branch <b>] [--evidence-root <p>]` | Every pre-approval gate; production read-only throughout |
| `mac-rail-b-production.sh --release <id> --marker <path> [--check-only]` | Deploys only when the exact operator-created marker already exists |
| `mac-rail-b-rollback.sh --api-image <id> --web-image <id>` | Restores exact preserved images with `--no-deps`, re-verifies catalogue and canonical-price parity |
| `rail-b-lib.sh` | Branch semantics, gate-state machine, evidence-path safety |
| `rail-b-selftest.sh [--json <p>]` | Hermetic fault matrix |

## Runtime-defect behaviour

Preapproval is a validator and release finaliser, **not a code-repair engine**. If
`playwright.exactImage`, `runtime.newRestoredCanary`, `upgrade.migrate`, `upgrade.idempotent` or
`api.catalogueCollection` fails, it stops with **`MAC_RAIL_B_RUNTIME_DEFECT_FOUND`** and does not
freeze a release, derive a release ID, create a tag, push a package head, or emit marker
instructions. Implement the defect, commit it, rerun every invalidated gate, then restart
preapproval with a new executable candidate.

## Validation performed

- **Syntax** 5/5 (`bash -n`). ShellCheck is not installed here — recorded `NOT_APPLICABLE`, which is
  not a release failure; the Mac run re-evaluates it.
- **Fault matrix 36/36**, hermetic: never contacts production, never creates a marker, never touches
  real Docker resources or a real Git remote. Classes: host/local-source, remote-movement,
  release-identity, evidence-path, approval-marker, deployment/rollback, commerce-safety, gate-state.
- **Evidence-path safety** — rejects paths inside the Git root, inside `.git`, inside the
  quarantined `GoldPlusFinal`, and symlinks into any of them; paths resolve physically first.
- **Prohibition audit** on executable lines with comments stripped: 0 `docker compose down`,
  0 reboots, 0 Caddy/PostgreSQL/Redis restarts, 0 marker writes, 0 wildcard removals.

## Lint (parsed, not transcribed)

| | errors | warnings |
|---|---|---|
| shared | 0 | 0 |
| api | 0 | 889 |
| web | 0 | 21 |
| **aggregate** | **0** | **910** |

Parsed from `pnpm lint` by `scripts/release/claude/reconcile-lint.mjs`. Recorded as a
**no-regression ceiling**; a broad unrelated cleanup is out of scope for this release.

## Running Rail B on the Mac

```bash
cd /Users/robertsebunya/Documents/GitHub_Projects/goldplus-mac-rail-b-20260728T175024Z/goldplus-commerce
git fetch origin phase-2-measurement-control-tower-completion
git merge --ff-only origin/phase-2-measurement-control-tower-completion
scripts/release/claude/mac-rail-b-preapproval.sh --dry-run
scripts/release/claude/mac-rail-b-preapproval.sh
```

Evidence defaults to `goldplus-mac-rail-b-evidence-<timestamp>` beside the outer Git root.

Neither Claude nor any script creates or removes an approval marker.
