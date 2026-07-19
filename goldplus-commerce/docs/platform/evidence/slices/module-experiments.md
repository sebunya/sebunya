# Module Experiments — deterministic assignment and exposure evidence

Date: 2026-07-20 (Africa/Kampala). Base: clean local/origin Automation A5 head
`c84fa6996f86c2d78f62c20f9e3172b311f8a243`.

## Implemented boundary

The module adds a pure deterministic weighted-assignment policy; DRAFT, READY, RUNNING, PAUSED, COMPLETED,
INCONCLUSIVE and INVALID lifecycle; durable definitions, immutable variants, assignments and exposure evidence;
optimistic transitions; atomic assignment-plus-exposure idempotency; exact experiments.read/manage/assign permissions;
protected Hono/Zod API; shared lifecycle audit; and server-rendered Astro list/detail operating pages.

Subjects are SHA-256 hashed before persistence. Assignment cannot commit without its exposure row. A unique
experiment/subject key prevents reassignment and a unique experiment/exposure key prevents duplicate measurement.
Only RUNNING experiments assign. Completion decisions remain operator-governed. The module reports significance as
`NOT_CALCULATED` with an explicit reason and makes no unsupported statistical claim.

Migration `0041` is additive and changes no prior migration. It creates four tables, seven indexes/unique indexes,
four foreign keys and a variant-weight check. It does not modify checkout, pricing, consent, Customer DNA, Automation,
providers, outbox, notification, or deployment paths.

## Evidence

- domain/API/admin-inventory/architecture focused gate: 5 files / 49 tests PASS;
- clean-commit repository suite: 193 files / 4,026 tests PASS;
- workspace typecheck and API/Astro production build: PASS;
- secret scan: 1,134 source/config files PASS without printing values;
- changed-path lint: zero errors (warnings only);
- fresh PostgreSQL replay `0000`–`0041`: 42 migration records, four experiment tables, four foreign keys;
- real PostgreSQL proof: `DRAFT→READY→RUNNING→PAUSED`, stable deterministic variant, one assignment and one exposure
  under two concurrent calls, duplicate observed, hashed subject, paused assignment denied, `NOT_CALCULATED`
  significance, four audit rows, zero orphan exposures and zero residue; verdict PASS;
- protected API tests: logged-out 401, missing permission 403, exact read succeeds, invalid variants rejected before
  use case, and read permission cannot assign;
- admin list/detail pages compile in the production Astro build and expose empty, denied, unavailable, lifecycle,
  stale-operation, evidence and explicit no-significance states.

Status: `SOURCE_COMPLETE_NOT_DEPLOYED`. No production deployment, real customer assignment, provider transport,
consent change, or `LIVE_VERIFIED` claim occurred.
