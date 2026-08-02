# Next resume

Read `EXECUTION_STATE.json` first. **Resume point: Slice 3 (Platform Foundations).**

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
