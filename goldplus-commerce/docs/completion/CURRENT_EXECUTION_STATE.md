# CURRENT EXECUTION STATE (2026-07-20 · Pricing P3)

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
- Next gate: commit/push P3, prove clean local/remote alignment, then begin P4 checkout/order/payment integrity.

---
