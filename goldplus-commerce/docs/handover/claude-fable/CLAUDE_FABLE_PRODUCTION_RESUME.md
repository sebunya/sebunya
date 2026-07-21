# CLAUDE FABLE — PRODUCTION RESUME (repaired catalogue-parity release)

**State: PAUSED_AWAITING_NEW_OPERATOR_APPROVAL_MARKER.**
Engineering is complete on origin. Do not repeat RCA, monitor repair, storefront repair, module work
or fault-injection design. The machine-readable twin of this file is
`CLAUDE_FABLE_PRODUCTION_RESUME.json` (same directory) — it is the resume authority.

## Verified release identity (recomputed, not assumed)

| Field | Value | How verified |
|---|---|---|
| Release ID | `goldplus-programme-13633d86-m0048-5c6f9d25` | manifest §release |
| Release token | `13633d86-m0048-5c6f9d25` | executable sha8 + m0048 + scope sha8 |
| Executable commit | `13633d86c808bd6fde49c47248f234b861a411bb` | exists; ancestor of package head; tree = `68b0ac4a…` matches manifest |
| Release-package head | `0823281cfae2cac6e3c669188e802b35ed0b69dc` | sole commit after executable = freeze commit; == origin tip |
| Scope manifest SHA-256 | `5c6f9d25…70ad60` | **independently recomputed** with the manifest's canonicalization: MATCH |
| Migration ceiling | `0048` | ledger files end at `0048_search_insights.sql`; repair adds no migration |
| API image | `goldplus-commerce-api:goldplus-programme-13633d86-m0048-5c6f9d25` @ `sha256:259440b3…2677f` | manifest §images |
| Web image | `goldplus-commerce-web:goldplus-programme-13633d86-m0048-5c6f9d25` @ `sha256:d3399565…487ee` | manifest §images |
| Frozen | YES at `0823281` (committed + pushed) | no new freeze required |
| Supersedes | `REJECTED_GOLDPLUS_PROGRAMME_682384B2_M0048_B79A4DE7` | retired release must never be redeployed |

## Operator approval handoff (the only human step)

On the production-connected host, as the operator (Claude must never create, modify or remove markers):

1. Confirm the consumed prior marker is ABSENT:
   `/root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_682384b2-m0048-b79a4de7`
   (RCA recorded it still PRESENT at terminal reconciliation — if present, the **operator** removes it first.)
2. Create the new release-bound marker:
   - Path: `/root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_13633d86-m0048-5c6f9d25`
   - Exact one-line content: `APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_13633d86-m0048-5c6f9d25`
   - Regular file (not a symlink), `root:root`, mode `600`.
3. Reply: `CONTINUE FROM REPAIRED RELEASE APPROVAL`

## Environment note (recorded honestly)

This resume state was produced in a Linux sandbox where `ssh` is absent, `goldplus-prod` does not
resolve, the docker daemon is down, and `/opt/goldplus/app/goldplus-commerce` does not exist.
Every production phase (marker verification → shadow canary → preservation → rehearsal → ff-only
update → API-first deploy → replica parity → web deploy → UAT → 30-minute soak → reconciliation)
is therefore EXTERNAL_BLOCKED here and must run from the operator host where `ssh goldplus-prod`
works. Nothing production-side has been simulated or fabricated;
`GOLDPLUS_PROGRAMME_RELEASE_LIVE_VERIFIED_DORMANT_SAFE` is NOT declared.

## Continuation order (do not reorder; all on the production-connected host)

new-marker verification → single-attempt validation → read-only shadow canary (SQL vs shadow
repository/API/monitor parity; zero-write/zero-send) → persistent lock → source/config
preservation + exact rollback-image tags → DB backup + isolated restore → OLD-runtime
compatibility → REPAIRED-runtime catalogue parity → no-live-drift proof → production ff-only
update to `0823281` → exact image label/digest verification → API-first deploy (recreate `api`
only) → replica-by-replica verification (replica1 == replica2 == independent SQL truth == public
API == storefront; canonical prices unchanged) → 5-minute API stabilization → web deploy → safe
UAT (read/denial/empty/simulation/dry-run only) → 30-minute soak (checkpoints 0,1,5,10,15,20,30;
initial health is not final) → final reconciliation → production evidence commit + push.

Hard prohibitions: no Compose from `/root`; no `docker compose down`; no reboot; never restart
Caddy/PostgreSQL/Redis; no hard-coded product counts; no monitor weakening; no seed products over
a healthy live catalogue; no real orders/payments; providers and customer communications stay
dormant; never reuse the retired release or its marker; never claim success after rollback.
