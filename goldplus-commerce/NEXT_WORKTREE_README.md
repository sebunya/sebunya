# NEXT WORKTREE — PIM Import source complete; Shopping Assistant next

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

P7 freezes executable release `e0f7e80928398dc758b0d88c25800eab60899986`. Exact labelled images, plain-Node
and database-connected smoke, production-mode worker/ticker initialization, candidate Compose/Caddy validation,
fresh rollback tags/source archives/backup, isolated restore, exact 29→49 migration rehearsal and old-image rollback
compatibility all pass. Production source, live DB and seven service container identities remain unchanged.

Next: use `docs/platform/releases/pricing/PRICING_RELEASE_MANIFEST.json` and
`PRICING_DEPLOYMENT_AND_ROLLBACK_RUNBOOK.md`. P8 must first independently verify the exact operator-created root-only
marker. Missing/invalid approval means `PRICING_P8_BLOCKED_BY_APPROVAL_NO_CHANGES`: no lock, preservation, fetch,
migration, tag mutation or service action. With approval, deploy only exact `e0f7e809`, recreate API/web only, complete
safe UAT and a minimum 15-minute soak, and reconcile to `PRICING_PRODUCTION_LIVE_VERIFIED_DORMANT_SAFE`.

The marker check returned missing and therefore made no production or evidence change. Source completion continued.
Fraud Triage is committed at `6574952` and proven through migration `0043`, exact RBAC, protected API/Astro UI,
real-PostgreSQL concurrency/immutability/no-effect checks, fresh replay and a clean 200-file / 4,054-test suite. It is
`SOURCE_COMPLETE_NOT_DEPLOYED`; no live Fraud decision or production migration occurred. Its PIM Import selection was
subsequently completed as recorded below.

PIM Import is committed and pushed at `ab156aea207d281380f018ddfcb15e464bc893fc` and proven through migration `0044`, immutable source hashing, explicit mapping, deterministic zero-write preview, full drift snapshots, independent approval, per-row partial failure and exact rollback. The protected API/Astro control room has exact read/create/map/approve/apply/rollback RBAC. Real PostgreSQL proves zero protected-commerce, communication and provider effects and zero residue; fresh replay and the clean 202-file / 4,061-test suite pass. PIM Import is `SOURCE_COMPLETE_NOT_DEPLOYED`; no production migration or catalogue import occurred. Select Shopping Assistant next and reconcile the existing product-finder implementation against real catalogue/inventory/compatibility/Pricing, truthful `NO_MATCH`, and safe persisted interaction context before editing.

The detailed A3-A5 plan, protected assets, evidence manifest and risk register live under
`docs/handover/codex/`. The section below is the prior resume note (superseded by the handover and C0 package).

---
