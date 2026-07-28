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

The scope SHA is deliberately **not** written into this runbook or its JSON twin. The canonical
scope hashes the runbook (`railBRunbookSha256`), so embedding the SHA here would make the scope
self-referential by proxy and could never reach a fixed point. Derive it instead:

```bash
node scripts/release/claude/verify-claude-release-scope.mjs      # read-only; prints the SHA
node scripts/release/claude/resync-claude-release-scope.mjs      # separate tool; rewrites inputs
```

The verifier never rewrites its own expectation; resync is a separate, deliberately-invoked tool
that reuses the verifier's `rebuild`, refuses to repoint `executableCommit`, and carries
operator-declared fields through untouched.

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

`PASS` is reachable **only** when a command actually ran and exited zero. A dry run records
`NOT_RUN` for every skipped execution gate, while the gates that genuinely execute (host
attestation, branch semantics, executable boundary) legitimately record `PASS`. A final result is
impossible while any mandatory gate is `FAIL`, `BLOCKED` or `NOT_RUN`.

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
| `mac-rail-b-verifier.sh` | Tracked canonical verifier — release authority; an attachment or Downloads copy is not |
| `mac-rail-b-finalise-release.sh --validation-run <abs path>` | Consumes one successful validation summary; creates the package head and remote annotated tag |
| `mac-rail-b-verify-finalised-release.sh --manifest <abs path>` | Independently re-verifies remote branch, annotated tag, package head, final scope and image digests |
| `rail-b-lib.sh` | Gate state machine, deterministic Docker readiness, branch semantics, evidence-path safety, fail-closed helpers |
| `rail-b-selftest.sh [--json <p>]` | Hermetic fault matrix |
| `rail-b-api-linkage-test.sh [--json <p>]` | Shell API linkage contract (`declare -F`) |

## Runtime-defect behaviour

Preapproval is a validator and release finaliser, **not a code-repair engine**. If
`playwright.exactImage`, `runtime.newRestoredCanary`, `upgrade.migrate`, `upgrade.idempotent` or
`api.catalogueCollection` fails, it stops with **`MAC_RAIL_B_RUNTIME_DEFECT_FOUND`** and does not
freeze a release, derive a release ID, create a tag, push a package head, or emit marker
instructions. Implement the defect, commit it, rerun every invalidated gate, then restart
preapproval with a new executable candidate.

## Validation performed

- **Syntax** 9/9 (`bash -n`). ShellCheck is not installed here — recorded `NOT_APPLICABLE`, which is
  not a release failure; the Mac run re-evaluates it.
- **Shell API linkage** — `SHELL_API_LINKAGE_PASSED`, 0 undefined, 0 late-source, 0 shadowed.
- **Fault matrix 94/94**, hermetic: never contacts production, never creates a marker, never touches
  real Docker resources or a real Git remote. Classes include host/local-source, remote-movement,
  release-identity, evidence-path, approval-marker, deployment/rollback, commerce-safety,
  gate-state, terminal-abort, docker-context, validation-evidence, final-scope,
  production-contract, linkage, fail-closed, dry-run-assessment, placeholder and failed-run.
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

One fail-closed block. Do not split it across terminal sessions and do not
substitute values by hand.

```bash
set -Eeuo pipefail
cd /Users/robertsebunya/Documents/GitHub_Projects/goldplus-mac-rail-b-20260728T175024Z/goldplus-commerce
git fetch origin phase-2-measurement-control-tower-completion
git merge --ff-only origin/phase-2-measurement-control-tower-completion
bash scripts/release/claude/mac-rail-b-verifier.sh
bash scripts/release/claude/mac-rail-b-preapproval.sh
```

- **Do not run preapproval when the verifier fails.**
- **Do not run the finaliser** unless validation returns exactly
  `CLAUDE_MAC_RAIL_B_VALIDATION_COMPLETE_RELEASE_FINALISATION_REQUIRED` and prints a real
  absolute summary path.
- **Do not run remote tag verification** unless finalisation succeeds.

Validation and finalisation stay separate operator decisions; nothing chains automatically.

Finalisation and remote verification use tracked, fail-closed scripts — never a copy-paste block:

```
scripts/release/claude/mac-rail-b-finalise-release.sh --validation-run <path printed by the validator>
scripts/release/claude/mac-rail-b-verify-finalised-release.sh --manifest <path printed by the finaliser>
```

Those two lines are prose, not a runnable block: both scripts refuse an angle-bracket
literal, a relative path, a symlink and a missing file, so a pasted placeholder fails
closed instead of appearing to succeed.

## Why the previous Mac run failed

The first real Mac execution stopped at
`railb_assert_no_runtime_source: command not found` while the hermetic suite reported
69/69, because the suite exercised library functions directly and never checked that the
*callers* referenced functions that exist. `bash -n` cannot see a missing sourced function.

Two fixes close that gap permanently:

- one canonical boundary function, `railb_assert_executable_boundary`, enforcing all three
  counts, with every stale caller updated and no compatibility alias;
- `rail-b-api-linkage-test.sh`, which enumerates every `railb_*` call in every tracked
  caller and proves it exists with `declare -F`. Fault injection confirms it fails on the
  exact Mac defect and on a misspelling, while `bash -n` still passes.

The verifier's dry-run predicate was also wrong: it treated any `PASS` as untruthful, but a
truthful dry run legitimately passes the gates that genuinely execute. It now checks exit
code, executed attestation gates, `NOT_RUN` for skipped work, zero FAIL/BLOCKED and the
absence of validation, finalisation and marker wording — and prints
`predicate` / `expected` / `actual` / `evidence` when it fails.

## Dry-run truthfulness has three outcomes, never two

Truthfulness is a property of a dry run that was *allowed to run*. On a non-Darwin host the
validator refuses at gate 1 by design, so a non-zero exit there is correct fail-closed
behaviour — not a lie. The verifier separates the cases:

| Host | Dry run | `DRY_RUN_ASSESSMENT` | `DRY_RUN_TRUTHFUL` | Terminal line | Exit |
|---|---|---|---|---|---|
| Darwin | exit 0, predicates hold | `ASSESSED` | `true` | `GOLDPLUS_MAC_RAIL_B_PACKAGE_VERIFIED` | 0 |
| Darwin | any predicate fails | `ASSESSED` | `false` | `DRY_RUN_NOT_TRUTHFUL` | 13 |
| non-Darwin | refuses at host attestation | `NOT_ASSESSABLE_NON_DARWIN_HOST` | `not_assessable` | `GOLDPLUS_MAC_RAIL_B_PACKAGE_STRUCTURE_VERIFIED` + `DRY_RUN_ASSESSMENT_REQUIRES_DARWIN_HOST` | 14 |

On a non-Darwin host the refusal is itself asserted against a wrong-host contract — exit
code exactly `10`, the reason `WRONG_OPERATING_SYSTEM: <os>`, and no validation,
finalisation or marker wording anywhere in the log. A wrong-host refusal that is *not*
exact aborts with `WRONG_HOST_DRY_RUN_CONTRACT_FAILED` (exit 15).

Exit 14 is not a pass. Structure, branch semantics and the executable boundary are proven,
but **dry-run truthfulness is unproven** and preapproval must not be run from that host.
Only a Darwin run of this verifier can print `GOLDPLUS_MAC_RAIL_B_PACKAGE_VERIFIED`.

Every tracked entry point now runs `set -Eeuo pipefail` with an `ERR` trap, so an
unexpected shell error records terminal evidence, marks the run ineligible and never prints
a success status.
