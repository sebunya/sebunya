# NEXT WORKTREE — Loyalty source complete; Search Insights next

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

PIM Import is committed and pushed at `ab156aea207d281380f018ddfcb15e464bc893fc` and proven through migration `0044`, immutable source hashing, explicit mapping, deterministic zero-write preview, full drift snapshots, independent approval, per-row partial failure and exact rollback. The protected API/Astro control room has exact read/create/map/approve/apply/rollback RBAC. Real PostgreSQL proves zero protected-commerce, communication and provider effects and zero residue; fresh replay and the clean 202-file / 4,061-test suite pass. PIM Import is `SOURCE_COMPLETE_NOT_DEPLOYED`; no production migration or catalogue import occurred.

Shopping Assistant is committed and pushed at `95d672bdd6babc3b0b55031a0c961b27a47bc120`. The product finder now enforces capability-backed session ownership, native JSONB persistence and a single completion winner; it reads active approved catalogue rows, unreserved inventory, declared compatibility, canonical retail prices and the existing non-persistent Pricing evaluator. It reports `NO_MATCH` truthfully and records interest-only actions through safe browser DOM handling. Real PostgreSQL proves zero preference/provider/protected effects and zero residue; focused 37/37 and the clean 203-file / 4,064-test suite pass. No migration or deployment occurred. Select Surveys next and reconcile consent/audience/response/analysis/export requirements against actual repository assets before editing.

Surveys is committed and pushed at `d5cdec7c58e2c470beeb7fee37545d2a2ddf58b6`. Migration `0045` adds governed definitions, immutable versions, PII-minimized responses and immutable events. Current personalization consent plus Customer DNA lifecycle determine eligibility; response ownership is hashed, completion rechecks gates, and analysis/export do not expose participant references. There is no invitation, provider, outbox or communication path. Real PostgreSQL proves four-eyes governance, consent exclusion, one concurrent completion winner, zero protected deltas/provider calls/residue; fresh replay, focused 54/54 and clean 206-file / 4,075-test suite pass. Surveys is `SOURCE_COMPLETE_NOT_DEPLOYED`; no production migration or response occurred. Select Copy Quality next and reconcile deterministic catalogue/CMS checks, explainable issues and provider-gated model boundaries before editing.

Copy Quality is committed and pushed at `de05a194a84936aed4028ca86a6dbcfc1ad2480f`. It reads canonical active/approved catalogue copy and applies deterministic required-field, placeholder, evidence, formatting, length and duplicate checks with explicit explanations and no subjective grade. The model boundary is truthfully `NOT_CONFIGURED` with zero provider calls. Distinct read/export RBAC protects the API and Astro control room; there is no migration, rewrite or publish path. Real PostgreSQL proves zero protected deltas/provider calls/residue; focused 52/52 and clean 209-file / 4,084-test suite pass. Copy Quality is `SOURCE_COMPLETE_NOT_DEPLOYED`; no production or catalogue mutation occurred. Select Behavioural Interventions next and reconcile ethical intervention governance, audience/experiment linkage, suppression and measured-outcome boundaries before editing.

Behavioral Interventions is committed and pushed at `42a3aa1ff82933eec4bab662aea789e3a505d6f3`. Migration `0046` adds governed definitions, immutable ethical versions, exposure/outcome evidence and events. Only truthful dismissible `ON_SITE` guidance is supported; a running Experiment treatment assignment, current personalization consent, Customer DNA audience, frequency cap and dismissal state all gate exposure. Treatment assignment, Experiment exposure and intervention exposure are atomic. Real PostgreSQL proves control suppression, one concurrent winner, idempotency, server-only target measurement, zero protected deltas/provider calls/residue; fresh replay, focused 61/61 and clean 212-file / 4,102-test suite pass. The module is `SOURCE_COMPLETE_NOT_DEPLOYED`; no production migration, live exposure or customer communication occurred. Select Loyalty next and reconcile its existing ledger/config/admin assets against earn, redeem, expire, reverse, concurrency and balance invariants before editing.

Loyalty is committed and pushed at `32e3ef0c24aa2bd06c85c73400b7dd2751507389`. Migration `0047` enforces ledger shape and unique expiry/reversal sources. Account-serialized transactions provide idempotent earn/redeem/expire/reverse; FIFO allocation expires only unspent points and every balance change has an immutable event. Verified payment completion uses persisted order identity/total but the dual gate remains dormant. The protected PII-minimized operations view is persistence-backed. Real PostgreSQL proves one concurrent redemption winner, exact partial expiry, collision/sign denial, zero protected deltas/provider calls/residue; fresh replay, focused 99/99 and clean 214-file / 4,116-test suite pass. Loyalty is `SOURCE_COMPLETE_NOT_DEPLOYED`; no production migration or activation occurred. Select Search Insights next and reconcile aggregate query/zero-result/CTR/conversion/demand/synonym/ranking insights against the no-raw-personal-history boundary before editing.

The detailed A3-A5 plan, protected assets, evidence manifest and risk register live under
`docs/handover/codex/`. The section below is the prior resume note (superseded by the handover and C0 package).

---
