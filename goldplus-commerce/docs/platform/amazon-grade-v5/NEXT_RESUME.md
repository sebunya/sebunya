# Next resume

Read `EXECUTION_STATE.json` first. **Resume point: Slice 3B (Slice 3A is DONE).**

## Slice 3A — DONE (commit `02644aa`, pushed)
One authoritative Redis-backed route-family distributed abuse-control layer closes stop-ship 7.13. Keyed on a stable route family (never the raw path), per-family Redis-outage policy, correct `Retry-After`. Proven on **real Redis** (16/16 integration) + 11 unit; typecheck/lint clean.

## Infra gate for DB-dependent work (finding ENV-01)
This MacBook has **no PostgreSQL server** (only `libpq` client tools), and Docker is unavailable because both the Lima x86 VM and colima need `qemu`, whose install would upgrade the operator's **pinned** toolchain (`glib`/`pkgconf`/`sqlite`/`python@3.14`/`meson`). The operator elected to protect those pins. So the **real-PostgreSQL integration proofs** the programme mandates for durable sessions (3B), MFA persistence (3C), db-client (3F) and Slices 4/7 must run in **CI or the Lane B environment** (where Docker/Postgres exists). A local real-Redis was available and used for 3A. To resume DB-dependent slices locally, an operator must either provide a reachable PostgreSQL (`ANALYTICS_TEST_DATABASE_URL` / project DB URL) or accept a one-off toolchain upgrade.

## Original Slice 3 plan (resume in a DB-capable environment)

Slice 2 (bigint money + non-negative/positive CHECKs, migration 0062) is repository-complete at commit `2f426b1`, parity 63/63, proven on real PostgreSQL. Migration 0062 is **repository-complete, not production-proven** — the §11 bigint production-safety evidence (table-size scan, ALTER lock behaviour on a production-like clone, backup/restore evidence) is a Lane B gate, not remaining repository work.

Continue with Slice 3 sub-slices in order, committing each coherent green sub-slice:

- 3A — trusted-proxy IP identity + one authoritative Redis-backed distributed abuse-control layer across all public endpoint families.
- 3B — durable revocable sessions, refresh rotation, logout (current/all), reuse detection, CSRF for cookie-authenticated mutations.
- 3C — privileged MFA enforcement + step-up assurance with freshness window.
- 3D — one Zod-backed configuration boundary; no raw `process.env` outside bootstrap/adapters.
- 3E — typed domain errors, central HTTP mapping, PII/secret-safe structured logs, remove application `console.*`.
- 3F — db-client transient-retry/timeouts/pool-metrics, modular lazy composition root, ordered graceful shutdown with truthful readiness.

Then continue automatically through Slices 4–12, the full hostile gate, immutable release, and (Lane B) SSH attestation → migration gate → canary → traffic shift → observation/rollback.

Never restart discovery from zero. Never create another programme branch. Never reset to Analytics V2.
