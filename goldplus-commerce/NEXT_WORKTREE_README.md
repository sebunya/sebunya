# NEXT WORKTREE — Pricing P6 accepted; P7 exact release candidate next

The forensic handover has been assimilated across the complete tracked repository. Start with
`docs/handover/codex/orientation/CODEX_CONTEXT_LEDGER.md`, then use the original handover pack under
`docs/handover/codex/` for slice-specific gates.

- Branch `phase-2-measurement-control-tower-completion`; verified forensic handover baseline
  `bfb0ffc3d004f8eecc039722f540eef75d8d7193` (local == origin before C0 documentation).
- C0 census: 1,690/1,690 tracked/classified, 1,620/1,620 text/inspected, 70 binary/assets,
  zero unclassified. Orientation artifacts are under `docs/handover/codex/orientation/`.
- Automation A1–A4 are committed and pushed through `f628b6d0b9cbd31193506f3940429bdc0482de24`.
  A5 is locally complete and proven through real PostgreSQL, the protected API, built Astro UI, a controlled fake provider,
  explicit per-state counters, migration rehearsals, concurrency/crash/ambiguity/replay checks, and zero proof residue.
- Migrations exist through **0040**. A5 needs no migration or runtime source change, adds no parallel infrastructure,
  calls no real provider, and makes no deployment or `LIVE_VERIFIED` claim.
- Do not rewrite migrations 0000-0039; do not duplicate scheduler/outbox/router/consent/audit/RBAC.

Automation A5 is pushed at `c84fa6996f86c2d78f62c20f9e3172b311f8a243`; Experiments is pushed at
`97f304565679284e7bf6731f56d0183a6e7fd239`. Pricing P1–P5 are pushed through route-census head
`09ceb5a182acaceb913b5f73844f4844060360c0`. P6 adds only the integrated acceptance runner and evidence.
All five real-PostgreSQL Pricing proofs pass with zero real-provider calls and residue; fresh `0000`–`0042` and
populated `0041`→`0042` pass; compiled plain-Node and production Linux/amd64 API/web image smokes pass. Production
services and source were not changed. Pricing is `SOURCE_COMPLETE_NOT_DEPLOYED`.

Next: P7 must freeze one exact executable commit, rebuild labelled API/web images from it, run the separate
database-connected production-image smoke, create and verify the production backup, restore it into an isolated
on-server scratch database, apply only `0042`, prove schema/data/Pricing/rollback invariants, and assemble the complete
rollback package. Do not deploy, switch production source, apply the live migration, or recreate services before every
P7 gate is green. P8 remains independently approval-marker gated.

The detailed A3-A5 plan, protected assets, evidence manifest and risk register live under
`docs/handover/codex/`. The section below is the prior resume note (superseded by the handover and C0 package).

---
