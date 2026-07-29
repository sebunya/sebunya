# Control Centre full activation — implementation report

**Status: engineering pass IN PROGRESS. This programme is NOT complete and the
completion token has not been returned.**

| | |
|---|---|
| Base commit | `7e952fd35de6d867b0039381e81523fd533d83f1` |
| Branch | `claude/control-centre-full-activation-20260729` |
| Worktree | `../goldplus-control-centre-full-activation-20260729` |
| Migration ceiling | `0048_search_insights.sql` (49 files, unchanged) |
| Runtime source changed | yes — a new executable candidate is required |

## 1. Forensic finding — this changes what the work is

The controlling document assumes the Commerce OS modules are dead. **They are not.**

| Claim | Observed |
|---|---|
| 14 Commerce OS modules show `API UNAVAILABLE` | All 14 have an admin page **and** a mounted API |
| Modules are missing | 52 route mounts in `apps/api/src/interfaces/http/app.ts`, 43 modules, 171 use cases |
| Readiness returns 404 | **No aggregated readiness endpoint existed at all** — nothing was mounted at `/admin/control-centre/*`, so any such request 404s by construction |
| Trust Centre badges reflect capability | Badges came from a **hard-coded literal table** in `apps/web/src/lib/admin-trust-centre.ts`; `"Needs configuration"` and `"Coming soon"` were authored strings with no link to whether anything worked |

**A "Commerce Operating System" page does not exist in this repository at any
commit** (`git log --all -S "Commerce Operating System"` returns nothing). The
screenshot therefore shows a surface built elsewhere, or a deployed artefact that
does not correspond to this branch. That must be reconciled before any claim of
"no dead cards" can be verified against the real production build.

Root cause of `API UNAVAILABLE`: **a missing aggregation endpoint plus a fabricated
status layer** — not missing modules. Recovering the existing capability was
therefore the correct first move, exactly as §2 requires, and no module was
duplicated.

## 2. Delivered in this pass

### Canonical module registry — `packages/shared/src/control-centre/module-registry.ts`
One typed source of truth, 24 entries covering every screenshot-visible Trust
Centre, Commerce OS and readiness card. Carries key, display name, description,
category, admin route, API mount, primary endpoints, required and optional
permissions, data and provider dependencies, activation policy, supported actions,
risk class, live mode, owner and runbook link.

It contains **no status field**. Status is computed, never authored — enforced by
a test that fails if a status literal appears in the module array.

### Computed readiness — `EvaluateModuleReadinessUseCase`
Three axes derived independently from real observations:

| Axis | Derived from |
|---|---|
| `serviceStatus` | route mounting + dependency probes |
| `accessStatus` | declared permission requirements |
| `activationStatus` | activation policy + provider configuration + approval records |

Permission and activation may **never** degrade service status, so a protected,
healthy, approved module reports `LIVE / PROTECTED / ACTIVE` — the case the old
single badge could not express. `UNAVAILABLE` is reserved for a genuinely unmounted
route. An unconfigured provider is `NOT_CONFIGURED`; a module with no side effects
is `READ_ONLY`; an unapproved one is `DORMANT`.

### Endpoint — `GET /admin/control-centre/modules` (+ `/registry`)
Mounted, authenticated, `REPORTS_READ`-gated. Mount presence is derived from
`MOUNTED_API_PREFIXES`, generated from `app.ts`, so a router that is deleted or
never mounted makes its module report `UNAVAILABLE` instead of claiming `LIVE`.
Probes live in `infrastructure/control-centre/DrizzleControlCentreProbes.ts`,
keeping Drizzle out of the HTTP layer. Provider probes test presence only; a test
asserts no credential value can reach the payload.

### Production copy
`API UNAVAILABLE`, `COMING SOON` and `NEEDS CONFIGURATION` are removed from the
production admin UI and the two offending values are **retired from the status
vocabulary** so they cannot return. Support operations is now Protected with a
working action; loyalty is Dormant with a working action to its operational ledger.

### Tests — 4222 passing (223 files), +25 new
`control-centre-integrity.test.ts` (17) and `control-centre-copy-scan.test.ts` (8):
registry has no authored status, keys unique, all 24 modules covered, every
`apiMount` really mounted, every card and action resolves to an existing admin
page, LIVE only when mounted and healthy, DEGRADED not UNAVAILABLE on dependency
failure, permission/activation never degrade service, loyalty LIVE+DORMANT until
approved, no credential leakage, and no forbidden copy in the production UI.

## 3. NOT delivered — required before completion can be claimed

1. **Control Centre UI is not yet wired to the endpoint.** The page still renders
   from the static module list. The endpoint, registry and tests exist; the UI
   binding does not.
2. **No Commerce OS page exists.** It must be built (or the real one located and
   reconciled) before "no dead cards" is verifiable.
3. **Per-module deep work (§5–§6) not performed.** Each module is mounted and
   reachable, but this pass did not implement or verify the per-module action
   inventories.
4. **`module_activation_approvals` table does not exist.** The approval probe
   fails closed to DORMANT, which is safe but means no module can currently reach
   ACTIVE by approval. A migration is required.
5. **No migration, integration, contract or exact-image Playwright run.**
6. **Remaining evidence documents from §15 not produced.**
7. **No new executable candidate frozen; no release scope recomputed.**

## 4. Gates run

typecheck PASS · build PASS · full suite 4222/4222 PASS · architecture 71/71 PASS ·
worktree clean. Not run: integration, contract, migration rehearsal, exact-image
Playwright, secret scan, module-inventory reconciliation.

## 5. Production mutation

None. No deployment, no release identity, no approval marker, no provider
activation, no customer communication.
