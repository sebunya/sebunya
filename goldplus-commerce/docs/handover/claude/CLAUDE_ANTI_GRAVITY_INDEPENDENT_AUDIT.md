# Claude independent audit of the Anti-Gravity work

Execution mode: **ENGINEERING_AND_RELEASE_MODE** (source reachable; `ssh goldplus-prod` absent).
Audited tip: `53cbde3`. Machine-readable twin: `CLAUDE_ANTI_GRAVITY_INDEPENDENT_AUDIT.json`.

Every claim below was reproduced against tracked source or the real Hono composition root.
Static text assertions were not accepted as proof of runtime behaviour.

## Verdicts

| ID | Claim | Status |
|----|-------|--------|
| AG-01 | Two measurement route mounts repaired | **VERIFIED** |
| AG-02 | Route-reachability test proves reachability | **INCORRECT** |
| AG-03 | Historic 128-module reconciliation complete | **INCORRECT** |
| AG-04 | Zero missing engineering gaps | **INCORRECT** |
| AG-05 | Full suite 217 files / 4144 tests | **PARTIAL** |
| AG-06 | Canonical non-circular release scope | **PARTIAL** |
| AG-07 | Clean local/origin alignment | **VERIFIED** |

## Why the reachability test was false confidence

`route-module-reachability.test.ts` reads `app.ts` as text and regexes `app.route(...)`. Its
docblock claims it proves "every route file is imported and mounted" and "no route file exists
that is imported but not mounted" — **no test enforces either**. It asserts a hard-coded list of
mount paths, so a route module that is never mounted stays invisible. Its RBAC assertion scans
only `interfaces/http/routes/admin`, so the three admin-mounted routers under
`presentation/routes` — none of which had any authentication — were never examined.

It was green while all four defects below were live.

## Defects found and repaired

| ID | Severity | Defect | Reproduction |
|----|----------|--------|--------------|
| AG-F1 | **CRITICAL** | `/admin/controlled-activation/live-canaries` had no auth | Unauthenticated `POST` → **200**, executed `createControlledLiveCanaryUseCase` |
| AG-F2 | **CRITICAL** | Dry-run accepted a body-supplied `adminId`, unauthenticated | Reached the DB layer; stopped only by `ECONNREFUSED` (no PostgreSQL in the sandbox) |
| AG-F3 | **HIGH** | Access policy used a stub granting `settings.manage` + `reports.read` to everyone | Read from source; the policy could never deny |
| AG-F4 | **MEDIUM** | `routes/admin/controlled-activation.ts` (9 endpoints + shipped UI) never mounted | `GET /admin/controlled-activation/summary` → **404** |
| AG-F5 | LOW | `GetSupportInboxUseCase` read the wall clock | Suite failure independent of the above |

Repairs: `8eff5fb` (AG-F1..AG-F4), `51b86fb` (AG-F5). Acting-admin identity is now always derived
from the session; body-supplied identity fields are ignored.

## Replacement test

`tests/architecture/admin-route-authentication.test.ts` drives the real app via `app.request()`.
Fault injection proves it is not vacuous:

| Injected fault | Result |
|---|---|
| Un-mount the governance router | **3 tests fail** |
| Remove `authMiddleware` from the live-canary router | **1 test fails** |
| Restore the hard-coded permission stub | **1 test fails** |

All faults were reverted; the tree is clean.

## Gates after repair

Full suite **219 files / 4180 tests, all passing on a clean tree** · architecture 4 files / 46
tests · API typecheck PASS · secret scan PASS (1247 files) · `git diff --check` clean.

Nine `Slice09*` files fail while the tree is dirty because they assert on `git status --porcelain`;
they pass once committed. That is a known property of those guards, not a regression — verified by
re-running the full suite after committing.

## Blocking evidence gaps

**GAP-1 — the historic 128-module truth map is not in this repository.** The cited commit
`bbdb3e1c` contains no `module-truth-map` and no `uat-gap-matrix`, and the required status
vocabulary (`production-working`, `working-needs-polish`, `half-built`, `unsafe-to-use`,
`schema-only`) appears **zero times across all 322 commits**. Anti-Gravity's
`HISTORIC_128_MODULE_RECONCILIATION.json` asserts `ALL_128_HISTORIC_MODULES_ACCOUNTED_FOR` while
containing **no per-module rows**, and its summary keys are relationship types rather than the
mandated historic status totals. Producing 128 rows here would be invention. The truth map must be
supplied from outside this repository, or an inventory-only acceptance basis must be authorised.

**GAP-2 — production is unreachable.** `ssh` is absent and `goldplus-prod` does not resolve, so
shadow canary, backup rehearsal, deployment, per-module UAT, the one-hour soak and reconciliation
cannot be executed or evidenced from here.

Consequently `GOLDPLUS_ALL_MODULES_LIVE_VERIFIED_DORMANT_SAFE` is **not** declared.
