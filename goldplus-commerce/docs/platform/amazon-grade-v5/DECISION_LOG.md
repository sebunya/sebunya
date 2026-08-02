# V5/V7 Decision Log

Design decisions taken during the programme. Format: date · decision · rationale · reversibility.

## 2026-08-02 — V7 resume

- **D-01 · Resume in place on the existing branch at HEAD `6205dd0`.** The prompt-declared continuation head/tree matched exactly (`git merge-base --is-ancestor` passed, tree `e870b7c`). No new branch, no reset to Analytics V2. *Reversible: N/A (no change).*
- **D-02 · Repair durable state exactly once before engineering.** Corrected `NEXT_RESUME` (Slice 2→Slice 3), the money finding (repository-complete vs production-pending), `EXECUTION_STATE` (added `stateSnapshotParent`/`observedBranchHeadAtResume`/`lastGreenEngineeringCommit`), and the stale Slice-0 environment attestation (Linux/uid-0 container → verified MacBook Darwin/uid-501 with ssh present). Created the four missing §5 ledgers. *Additive, reversible.*
- **D-03 · Environment is the MacBook; Lane B SSH lane is available.** Verified Darwin, uid 501, `git/ssh/node/pnpm/docker` all present. Lane B attestation is attempted only after applicable Lane A gates pass. *N/A.*
- **D-04 · Cleared rebuildable dev/app caches (pnpm store, npm cache, ~/Library/Caches ≈ 8.7 GB) with explicit user authorization** because the MacBook was at 100% disk (320 MB free), which blocked dependency install and the whole build. Reclaimed to ~6.8 GB free. No user documents touched; caches regenerate. *Reversible (caches rebuild on demand).*

## Slice 3 decisions

_(appended as each sub-slice is implemented)_
