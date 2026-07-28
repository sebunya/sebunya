# Mac Rail B runbook

Deterministic MacBook-local / Hetzner-remote execution package. Machine-readable twin:
`MAC_RAIL_B_RUNBOOK.json`.

Rail A completed everything reachable from a cloud Linux environment. Rail B produces the
release-scope inputs that **only** the Mac can generate — exact images, production-shaped data and
complete browser journeys — and then deploys.

## Rail A result

| | |
|---|---|
| Executable candidate | `232e2903410e317d06e1416f67ed5f85904eb693` (**unchanged**) |
| Why unchanged | Rail A altered **no runtime source**; every commit is tests, tooling, inventory or evidence |
| Module inventory SHA-256 | `0ccb4f4d2fd3d6b1fdd764b438d198ce01271a8d74b5584b7010ce01c5e6f180` |

## Scripts

| Script | Purpose |
|---|---|
| `scripts/release/claude/mac-rail-b-preapproval.sh [--dry-run]` | Every pre-approval gate. Production stays **read-only** throughout. |
| `scripts/release/claude/mac-rail-b-production.sh --release <id> --marker <path>` | Deploys, but only once the exact human-created marker exists. |
| `scripts/release/claude/mac-rail-b-rollback.sh --api-image <id> --web-image <id>` | Restores the exact preserved images with `--no-deps` and re-verifies catalogue and canonical-price parity. |

All three use `set -euo pipefail`, wrap every production action in `ssh goldplus-prod`, and never
run a local `cd /opt/goldplus/...`.

## Validation performed

- **Syntax** — 3/3 pass (`bash -n`).
- **Dry run** — the host attestation correctly reported this non-Darwin host as FAIL. Unexecuted
  steps print `NOT-RUN(dry-run)`, never `PASS`; reporting PASS for work that did not run is exactly
  the fabricated evidence this programme exists to prevent.
- **Fault injection — 9/9 refused**: missing `--release`, missing `--marker`, non-approval marker
  path, wildcard marker path, unknown argument, absent marker, missing `--api-image`, missing
  `--web-image`, unknown rollback argument.
- **Prohibition audit** — `set -euo pipefail` 3/3; zero `docker compose down` invocations, zero
  reboots, zero Caddy/PostgreSQL/Redis restarts, zero marker writes, zero wildcards under `/root`.
  (Grep hits are the prohibition *comments*; the `/root/APPROVE` prefix match is the marker-path
  validation guard, not a glob.)

## Running Rail B on the Mac

```bash
cd /Users/robertsebunya/Documents/GitHub_Projects/goldplus-mac-rail-b-20260728T175024Z/goldplus-commerce
git fetch origin phase-2-measurement-control-tower-completion
git merge --ff-only origin/phase-2-measurement-control-tower-completion

scripts/release/claude/mac-rail-b-preapproval.sh --dry-run   # inspect the plan
scripts/release/claude/mac-rail-b-preapproval.sh             # run every gate
```

The pre-approval script writes timestamped JSON evidence outside Git (override with
`GOLDPLUS_EVIDENCE_ROOT`). It records image IDs, the backup SHA-256 and the migration journal —
the inputs the final release scope needs.

Only after those gates pass do you freeze the release, push the annotated tag from the Mac, and
create the approval marker by hand.

## Marker safety

Neither Claude nor any script creates or removes a marker. The production script **verifies** one
exact path: regular file, not a symlink, `root:root`, mode `600`, link count 1, and content
matching the release. It refuses a wildcard path outright.

## Lint baseline

**0 errors, 889 API warnings + 21 web warnings** — recorded as technical debt and a
**no-regression ceiling**. A broad unrelated cleanup is deliberately out of scope for this release.
Changed files must introduce zero new lint errors and no unjustified warning increase.

## Why no release was frozen in Rail A

Exact image identities, restored production-shaped data and complete Playwright results are release
**scope inputs**. They can only be produced on the Mac. Freezing in Rail A would create yet another
candidate carrying unrun gates — the precise failure that retired the previous five candidates.
