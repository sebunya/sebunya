# CURRENT EXECUTION STATE (2026-07-20 · PIM Import source complete)

- The forensic handover was verified at `bfb0ffc3d004f8eecc039722f540eef75d8d7193`, then Codex completed
  C0 whole-codebase assimilation without application-source changes. The durable orientation package is
  under `docs/handover/codex/orientation/` and is committed by the documentation-only commit carrying this update.
- Branch `phase-2-measurement-control-tower-completion`; C0 baseline local HEAD equalled origin at
  `bfb0ffc3d004f8eecc039722f540eef75d8d7193` with a clean tree before documentation generation.
- Census reconciled: 1,690 tracked/classified files, 1,620 tracked/inspected text files, 70 binary/assets,
  zero unclassified. See `docs/handover/codex/orientation/CODEX_CODEBASE_CENSUS.json`.
- Automation **A1 complete** (a3a3146), **A2 complete** (2000fce), and **A3.0 implementation proven** from
  C0 head `132ff1fc04977acd87e5d5c9f0702603786267f7`. Real PostgreSQL classified the JSONB condition as
  `ACTIVE WRITE DEFECT`; the bounded adapter now writes native JSONB objects/arrays, reads at most one legacy
  layer, rejects malformed configuration, and needs no migration. A3.0 is committed/pushed at `a44f456`.
- Automation **A3.1 implementation proven** from clean A3.0 head `a44f456bc69d6d6fa0c834ff51f7d13f85d4c9de`:
  fixed fail-closed eligibility order, full exact suppression enum/persistence, and transactionally serialized durable
  cap reservation. Additive migration `0040` is required because plans/suppressions cannot safely represent reusable
  positive slots or exclude non-live outcomes. No prior migration changed.
- Automation **A3.2 implementation proven** from clean A3.1 head `74b05db5db7294eafa39d63f7297229372373d74`:
  external actions atomically reserve/reuse a cap and persist/link exactly one no-send intent in the existing outbox;
  configured fulfilment actions delegate to the existing idempotent use case, and unsupported internal families fail
  closed as NOT_CONFIGURED. Registry is wired; no provider is a dependency of the action use case.
- Automation **A3.3 implementation proven** from clean A3.2 head `6a0f924ca97568b14d8536eb6ae793afbefd2917`:
  the existing router gains an Automation-only outcome wrapper; SENT requires explicit adapter success, attempted
  known failures dead-letter at eight, ambiguous attempts become non-replayable OUTCOME_UNKNOWN, reconciliation
  requires actor/reason evidence, and replay re-evaluates all gates while reusing the original cap and outbox path.
- Automation **A3.4 implementation and proof committed/pushed** at `ebccac4b88d2a9b4dee4c5b5a54ebbbe89f19d34` from clean A3.3 head `2b88fd906a708d47eaa57d070e912cdd19d8d6f1`.
  Its PostgreSQL proof first reproduced two outbox owners/two provider effects, then verified the bounded no-migration fix:
  one durable outbox owner, one active PROCESSING attempt, one provider effect, conservative crash ambiguity, all 13
  prohibited states at zero calls, evidence-backed reconciliation, cap-preserving replay, and zero residue.
- Automation **A4 operating surface complete locally** from clean aligned A3.4 head `ebccac4b88d2a9b4dee4c5b5a54ebbbe89f19d34`:
  exact seven-way Automation RBAC, thin protected Hono/Zod API, immutable definition/version lifecycle, version-scoped
  approvals, dry-run/manual execution through existing A3 use cases, separate replay/reconciliation privilege, shared
  audit, truthful persistence aggregates, and real server-rendered Astro list/detail/execution operating pages. No
  schema/migration, provider transport, second worker, outbox, scheduler, router, or static execution/provider data was added.
- Automation **A5 acceptance complete locally** from clean aligned A4 head `f628b6d0b9cbd31193506f3940429bdc0482de24`:
  the complete immutable lifecycle, real trigger, Customer DNA/condition evidence, internal action, zero-call dry run,
  concurrent cap/action/outbox creation, controlled fake-provider delivery, terminal replay guards, pause/resume, audit,
  observability, crash/ambiguity/reconciliation and cleanup invariants pass against PostgreSQL 16.14. Fresh `0000`–`0040`
  replay, populated `0039`→`0040` upgrade, and built API/Astro Chromium evidence pass. Automation is now
  `SOURCE_COMPLETE_NOT_DEPLOYED`; no local evidence is labelled live.
- **Experiments complete locally** from clean aligned Automation A5 head `c84fa6996f86c2d78f62c20f9e3172b311f8a243`:
  deterministic weighted assignment, atomic exposure evidence, lifecycle/readiness/decision states, optimistic conflict,
  exact RBAC, shared audit, protected API and Astro operating pages are implemented. PostgreSQL concurrency and cleanup,
  focused 49/49, typecheck/build/architecture/secret scan, and fresh `0000`–`0041` replay pass. Statistical significance
  remains explicitly `NOT_CALCULATED`; no customer or production assignment occurred.
- Clean-commit suite after Experiments: 193 files / 4,026 tests passed.
- Other modules SOURCE_COMPLETE_NOT_DEPLOYED (Fulfilment F1-F5+UI, Inventory, Customer DNA & NBA 0037,
  Decision Intelligence 0038). Migrations proven through **0039** (REPORTED — rerun per handover).
- Production status: not reclassified by C0; nothing is newly claimed `LIVE_VERIFIED`.
- Codex entry point: `docs/handover/codex/CODEX_START_HERE.md` then `CODEX_BOOTSTRAP_PROMPT.md`.
- A3.0 proof: focused 23/23, architecture 10/10, typecheck/build/secret scan and fresh `0000`-`0039` replay
  passed; the PostgreSQL planning proof reports native object/array types, legacy semantic equality, malformed
  rejection, concurrency/idempotency, and zero provider calls. The dirty-tree full suite passed 3,959/3,971;
  its 12 failures are historical artifact allowlist guards and must be rerun from the clean A3.0 commit.
- A3.1 proof: focused 44/44, fresh replay through `0040`, populated `0039`→`0040` upgrade, and a real-PostgreSQL
  two-racer proof passed with one reservation, one exact capped suppression, winner retry slot reuse, and zero
  provider calls. Workspace typecheck, architecture 10/10, API/web build, secret scan, focused lint, and diff check pass.
- A3.2 proof: five focused Automation files / 50 tests and a real-PostgreSQL two-executor race pass with one
  QUEUED action, one cap, one linked native-JSONB outbox intent, `no_send_guarantee=true`, and zero provider calls.
  Typecheck, architecture 10/10, build, secret scan, focused lint, and diff check pass; no migration was added.
- A3.3 proof: 72 focused Automation/outbox tests pass (28 A3.3-specific). Real PostgreSQL proves ambiguous non-replayability and evidence reconciliation,
  eighth-attempt dead-lettering, cap retention/reuse, gate-revalidated replay through the existing outbox, successful
  effect non-replayability, ten fake-adapter calls, and zero network calls. Typecheck, architecture, build, secret scan,
  focused lint, and diff check pass; full lint retains its pre-existing unrelated one-error baseline. No migration was added.
- A3.4 proof: 13 prohibited-state counters are zero; delivery ownership/effect count is one; QUEUED and PROCESSING are
  distinct from SENT; positive, definitive-failure, ambiguous, eighth-failure, reconciliation, replay, and crash paths
  are evidenced; every scoped orphan/duplicate/residue count is zero. Focused 76/76, typecheck, architecture 10/10,
  build, secret scan, changed-path lint, and diff check pass. Full lint retains only the unrelated baseline error.
- A4 proof: focused Automation plus architecture 71/71, workspace typecheck/build, secret scan, changed-path lint and
  diff check pass. The real protected HTTP/PostgreSQL proof covers logged-out protection, draft/version/submission,
  approval/rejection, activation/pause/resume, stale conflict, dry-run zero calls, execution/suppression/attempt evidence,
  ambiguous replay denial, evidence-reference reconciliation, audit/correlation, aggregates and zero residue. Repository-wide
  lint remains `PRE-EXISTING UNRELATED BASELINE ERROR` at `ICustomerDnaRepository.ts:6`. Chromium desktop rendered the
  built Astro control room from a real scratch PostgreSQL definition through the API; the fixture was removed.
- Clean-tree full suite after the A4 commit: 191 files / 4,020 tests passed.
- Clean-commit full suite after A5: 191 files / 4,020 tests passed.
- Pricing P1 is implemented and proven from clean Experiments head `97f304565679284e7bf6731f56d0183a6e7fd239`: governed definitions, immutable versions, explicit approval/activation/pause lifecycle, integer-UGX benefit policy, shared audit, native JSONB persistence and additive migration 0042. Fresh replay has 43 migrations, nine Pricing tables and zero active rules; the self-cleaning PostgreSQL proof passes with zero provider calls.
- Pricing remains `SOURCE_PARTIAL`; P1 established its governed persistence and lifecycle boundary.
- Pricing P1 is pushed at `873d965542fd37212bc05db50470e0fea5013c93` with a clean 194-file / 4,030-test suite. P2 now adds one canonical-price evaluator with explicit qualification/exclusion evidence, deterministic stacking/tie-breaking/rounding/floors, safe hashed references, persisted explainable quotes and a non-persistent simulation path. Its real-PG proof passes with actual catalogue rows, native JSONB and zero provider calls/residue.
- Pricing P2 established the deterministic evaluation and explainable quote boundary.
- Pricing P2 is pushed at `2e80bd8c44d4433e5e56ee1dd71a7cd981a0b5c1`. P3 now adds one 0042-backed transactional capacity boundary. Real-PG races prove one global-slot winner, one same-customer winner and one same-coupon winner; reserve/redeem/release retries are idempotent; orphans, provider calls and residue are zero.
- Pricing P3 is pushed at `8627cdb6fa304804ce885ad00cf2bd21132eb398`. P4 wires production checkout to authoritative Pricing, atomically persists immutable order snapshots plus redemptions, compensates reservation on pre-order failure, and preserves committed-order amount through PesaPal retries and callback verification.
- P4 real-PostgreSQL proof passes with canonical `100000` versus injected `1`, final `180000`, one order/redemption, idempotent replay, forced-failure release, two controlled submissions at the immutable amount, zero outbox mutation, zero real provider calls and zero residue. Pricing plus architecture is 25/25; the extended focused set is 56/56; full workspace gates pass.
- Pricing P4 is pushed at `febdb9850d38d4433bdc7111124038f0ee94580c`; its clean suite is 197 files / 4,041 tests.
- P5 adds distinct Pricing RBAC, protected persisted APIs, real capacity/audit/Experiment evidence, audited governance operations and an Astro administrator control room. Safe simulation is non-persistent by construction.
- P5 real-PostgreSQL proof passes governed lifecycle/association, canonical simulation, active/paused capacity truth, zero business/communication deltas, zero provider calls and zero residue. Pricing plus architecture is 30/30; workspace gates pass; repository-wide lint retains only the established unrelated baseline error.
- Pricing P5 is pushed at `dd36b78`; the admin-route census correction is pushed at `09ceb5a182acaceb913b5f73844f4844060360c0`.
- P6 production-shaped acceptance runs all five Pricing PostgreSQL proofs under one deterministic runner, replays fresh `0000`–`0042`, proves populated `0041`→`0042` legacy order/line backfill, and executes the compiled Pricing proof under plain Node.
- Exact clean source `09ceb5a` built into production Linux/amd64 API/web images from the pinned Node digest. Network-none read-only image smokes passed API/web health and logged-out Pricing protection; all seven live production container IDs remained unchanged.
- Pricing is now `SOURCE_COMPLETE_NOT_DEPLOYED`. No live migration, deployment, promotion activation, provider call, customer communication or production database write occurred. P7 exact release-candidate freeze, database-connected image smoke, backup/restore rehearsal and rollback package are next.
- P7 froze executable release `e0f7e80928398dc758b0d88c25800eab60899986`, built labelled Linux/amd64 API/web images, passed plain-Node and database-connected compiled-runtime smoke, and proved worker/ticker startup and clean shutdown with zero provider or business mutation.
- A fresh production backup restored into isolated PostgreSQL 16 and exact candidate migrations rehearsed 29→49 rows. The six existing production-only historical ledger rows remain preserved; candidate `0023`–`0042` contributes 20 rows. Pricing is dormant, legacy order/line backfills match, and the old API image is compatible with the additive target schema.
- Production source, live DB and all seven running containers remained unchanged. Fresh rollback images, source archives, backup, release manifest and deployment/rollback runbook are ready. P8 is blocked unless its exact operator-created approval marker independently verifies.
- Pricing P8 independently checked the exact root-only approval path and found it absent. The check made no lock, preservation, source, migration, tag, service or evidence change; production remains unchanged and Pricing remains `SOURCE_COMPLETE_NOT_DEPLOYED` at its frozen P7 candidate.
- Fraud Triage is committed at `6574952`: review-first case/signal/assignment/operator-decision persistence, exact four-way RBAC, immutable transactional audit, protected API/Astro control room and additive migration `0043`. There is no public route, automatic decline, checkout/order/payment hook, provider path, worker or outbox path.
- Real PostgreSQL concurrency and cleanup proof passes with one case/signal winner, one assignment winner, explicit `REVIEW` then operator `DECLINE`, immutable resolution, zero protected-commerce/communication deltas, zero provider calls and zero residue. Fresh `0000`–`0043` replay has 44 migration rows. Clean suite passes 200 files / 4,054 tests; workspace typecheck/build, architecture, secret scan, changed-path lint and diff check pass.
- Fraud Triage is `SOURCE_COMPLETE_NOT_DEPLOYED`. The next engineering-controlled queue item is PIM Import.
- PIM Import is committed and pushed at `ab156aea207d281380f018ddfcb15e464bc893fc`: immutable canonical source rows and SHA-256 verification, explicit bounded mapping, deterministic non-writing preview, full catalogue snapshots, independent approval, separately privileged apply/rollback, exact RBAC, protected API/Astro control room and additive migration `0044`.
- Real PostgreSQL proves digest tamper denial, three valid/one invalid row, preview catalogue delta zero, creator self-approval denial, two applied rows with one safely contained concurrent conflict, exact rollback, hidden zero-stock draft creation, seven immutable events, zero inventory/order/payment/outbox/notification/attribute/image deltas, zero provider calls and zero residue. Fresh `0000`–`0044` replay has 45 migration rows and four empty PIM tables.
- Focused PIM/API/admin-route tests pass 40/40; architecture passes 10/10; workspace typecheck, API/Astro builds, secret scan, changed-path lint with zero errors and diff check pass. Clean full suite passes 202 files / 4,061 tests. PIM Import is `SOURCE_COMPLETE_NOT_DEPLOYED`; Shopping Assistant is selected next.

---
