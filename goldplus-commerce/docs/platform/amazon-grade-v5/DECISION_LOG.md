# V5/V7 Decision Log

Design decisions taken during the programme. Format: date · decision · rationale · reversibility.

## 2026-08-02 — V7 resume

- **D-01 · Resume in place on the existing branch at HEAD `6205dd0`.** The prompt-declared continuation head/tree matched exactly (`git merge-base --is-ancestor` passed, tree `e870b7c`). No new branch, no reset to Analytics V2. *Reversible: N/A (no change).*
- **D-02 · Repair durable state exactly once before engineering.** Corrected `NEXT_RESUME` (Slice 2→Slice 3), the money finding (repository-complete vs production-pending), `EXECUTION_STATE` (added `stateSnapshotParent`/`observedBranchHeadAtResume`/`lastGreenEngineeringCommit`), and the stale Slice-0 environment attestation (Linux/uid-0 container → verified MacBook Darwin/uid-501 with ssh present). Created the four missing §5 ledgers. *Additive, reversible.*
- **D-03 · Environment is the MacBook; Lane B SSH lane is available.** Verified Darwin, uid 501, `git/ssh/node/pnpm/docker` all present. Lane B attestation is attempted only after applicable Lane A gates pass. *N/A.*
- **D-04 · Cleared rebuildable dev/app caches (pnpm store, npm cache, ~/Library/Caches ≈ 8.7 GB) with explicit user authorization** because the MacBook was at 100% disk (320 MB free), which blocked dependency install and the whole build. Reclaimed to ~6.8 GB free. No user documents touched; caches regenerate. *Reversible (caches rebuild on demand).*

## Slice 3 decisions

- **D-3A-1 · One authoritative abuse-control layer keyed on route family, not path.** The prior design stacked several per-path `rateLimiter` mounts and a `global` limiter keyed on `c.req.path`, so a caller minted a fresh budget per invented URL. Chose one `publicAbuseControl` middleware + a pure `classifyPublicEndpoint` that collapses every request into a closed family set. Preferred additive change (kept the proven `RedisAbuseControlStore`, `limitFor`, confidence buckets and trusted-proxy resolver) over a rewrite. *Reversible: the middleware is a single `app.use`; families are data.*
- **D-3A-2 · Per-family Redis-outage policy.** Added an additive `outagePolicy` to `consume`: STRICT (÷4 local) for human forms/reads, GENEROUS (full local budget) for HMAC-authenticated provider webhooks — dropping a real payment confirmation during a Redis blip is worse than allowing the configured rate per replica. *Backward-compatible (defaults STRICT).*
- **D-3A-3 · Removed dead `rateLimiter.ts`** once superseded, to avoid a duplicate-limiter finding in the §20 hostile review. Confirmed no other references. *Reversible via git.*
- **D-3A-4 · Ran the real-Redis proof against a local ephemeral `redis-server` (brew, port 6399, no persistence)** because the Lima docker VM was stopped and heavy on a disk-constrained host. Honest evidence over a skipped suite. *N/A.*
