# Codex Context Ledger

This is the durable continuation ledger required before every implementation slice. Update it only with verified facts, commands, boundaries, proof outcomes, commit IDs, and unresolved risks.

## C0 — whole-codebase context assimilation

- Date: 2026-07-19 (Africa/Kampala)
- Outer Git root: `/Users/robertsebunya/Documents/GitHub_Projects/goldplus-commerce-next-phase-c1925dbd`
- Application root: `/Users/robertsebunya/Documents/GitHub_Projects/goldplus-commerce-next-phase-c1925dbd/goldplus-commerce`
- Branch: `phase-2-measurement-control-tower-completion`
- Verified baseline local HEAD and origin branch HEAD: `bfb0ffc3d004f8eecc039722f540eef75d8d7193`
- Baseline tree: clean before C0 documentation generation
- Controlling contract read in full: `/Users/robertsebunya/Downloads/Codex_GoldPlus_ULTIMATE_Whole_Codebase_Context_and_A3_Controller.md`
- Repository instructions read in full: `goldplus-commerce/AGENTS.md`

### Handover integrity

The required handover sequence was read in order: `CODEX_START_HERE.md`, `CODEX_EXECUTION_STATE.json`, `CODEX_PROTECTED_ASSETS_AND_INVARIANTS.md`, `CODEX_EVIDENCE_MANIFEST.json`, `CODEX_MASTER_HANDOVER.md`, `CODEX_REPOSITORY_MAP.md`, `CODEX_A3_WORK_PLAN.json`, `CODEX_A3_ACCEPTANCE_CHECKLIST.md`, `CODEX_COMMANDS_AND_PROOFS.md`, `CODEX_RISK_REGISTER.md`, `docs/completion/CURRENT_EXECUTION_STATE.md`, `NEXT_WORKTREE_README.md`, and `docs/completion/COMMERCE_OS_EXECUTION_QUEUE.json`.

- All four required JSON handover documents parsed successfully.
- All 25 paths in `CODEX_EVIDENCE_MANIFEST.json` existed.
- 23 of 25 manifest SHA-256 values matched.
- The two differences were `goldplus-commerce/docs/completion/CURRENT_EXECUTION_STATE.md` and `goldplus-commerce/NEXT_WORKTREE_README.md`. `git diff 3fe0f13218355bfe273348a75b6b77c845015637..bfb0ffc3d004f8eecc039722f540eef75d8d7193` proves the forensic handover commit itself changed exactly these continuation documents after the manifest anchors were calculated. Classification: expected handover-finalization change, not unexplained drift.

### Census and inspection reconciliation

The authoritative per-file census is `goldplus-commerce/docs/handover/codex/orientation/CODEX_CODEBASE_CENSUS.json`.

| Measure | Total |
|---|---:|
| tracked files | 1,690 |
| classified files | 1,690 |
| tracked text files | 1,620 |
| inspected text files | 1,620 |
| binary/assets | 70 |
| unclassified files | 0 |
| tracked bytes read | 18,188,738 |

Reconciliation: tracked equals classified; tracked text equals inspected text; unclassified is zero. Every tracked file was opened and hashed; every tracked text source, test, configuration, migration, script, and documentation file was read at least once. The census records path, SHA-256, byte count, type, classifications, package/module, text/inspection flags, generated classification, and inspection notes.

Corpus anchors observed during the complete text pass: 11 Drizzle transaction references, 10 `FOR UPDATE` references, 52 conflict-handling references, 94 Hono references, 260 Zod references, 121 audit references, 334 RBAC references, 166 logger references, 79 metrics references, 1,307 redaction/PII references, and 45 `JSON.parse` references. Counts are navigation signals, not quality scores.

### Architecture and status assimilated

- Clean/hexagonal direction: pure domain → application use cases/ports → infrastructure adapters → Hono/Astro interfaces; boundary tests enforce the important import rules.
- Runtime composition: Hono API entry starts the existing outbox ticker and BullMQ workers; Registry is the protected singleton dependency graph; Astro is a standalone server-rendered web app.
- PostgreSQL/Drizzle schema is split by bounded context. Existing concurrency conventions are transactions/row locks, optimistic versions, unique keys/conflict handling, and skip-locked outbox claiming.
- Existing shared execution assets: one outbox, one NotificationRouter, one OutboxTicker, one BullMQ/Redis QueueService. A3 must reuse these.
- Provider/live communication flags are fail-closed through exact enabling checks. C0 did not call providers, create consent, provision identities, migrate, deploy, or touch production.
- No dedicated Clock/IClock abstraction was found. Current pure policy convention is caller-supplied `Date`.
- Fulfilment/inventory, Customer DNA/NBA, and Decision Intelligence are protected. Their repository-recorded local proof status does not imply production deployment or live verification.
- Automation source status is A1+A2 only: domain/schema/migration, planning ports/use case/repositories, Registry wiring, units and a real-PG proof script. Automation admin API/UI and A3 execution are absent.

### Protected assets, decisions, contradictions, assumptions, and unknowns

- Protected: fulfilment and stock consumption, inventory reservation, Customer DNA/NBA, Decision Intelligence, consent/preferences, shared outbox/ticker/processor, NotificationRouter/providers, RBAC, audit, Registry ordering, DB wrapper, production/release controls, and migrations `0000`-`0039`.
- Decision: C0 changes documentation and factual state documents only. Application source remains untouched until the C0 commit/push and the implementation-readiness gate both pass.
- Decision: existing QueueService/BullMQ, OutboxTicker/outbox, NotificationRouter, consent, Customer DNA, Decision Intelligence, RBAC, and audit are reuse targets, not frameworks to duplicate.
- Contradiction resolved: the handover called BullMQ/Redis and clock presence unknown. Full-source inspection found BullMQ/ioredis in `goldplus-commerce/apps/api/src/infrastructure/queues/QueueService.ts` and no dedicated Clock/IClock; the effective convention is caller-injected `Date`.
- Contradiction retained for evidence: the schema says Automation fields are JSONB objects while the repository has double-encoding compatibility branches. Source alone does not prove whether the current writer, only legacy rows, or no active row is defective.
- Active assumption: `bfb0ffc3d004f8eecc039722f540eef75d8d7193` is the correct forensic baseline because local, origin, handover JSON, and user contract agree. Re-verify after each push.
- Unknown until real-PG gate: actual `jsonb_typeof` for newly inserted `automation_versions.config` and `automation_executions.evidence`, legacy row population/shape, SQL filtering behavior, and whether migration `0040` has any justification.
- Unknown until an explicitly authorized production slice: deployment/live status. Repository evidence and local proof must never be promoted to `LIVE_VERIFIED`.

### Commands and methods used

- Identity/integrity: `git rev-parse --show-toplevel`, `git branch --show-current`, `git rev-parse HEAD`, `git rev-parse origin/phase-2-measurement-control-tower-completion`, `git status --porcelain`, SHA-256 comparison, JSON parsing, path existence checks, and `git diff` across the handover anchor.
- Census: `git ls-files -z` equivalent input consumed by a bounded Node scanner; each tracked file was opened as bytes, hashed, typed and classified; detected text was decoded and scanned for imports, symbols, routes, schema tables and convention anchors.
- Deep verification: targeted `rg`, `sed`, package/config reads, import/reverse-import extraction, route/schema/symbol extraction, and representative end-to-end source/test/proof inspection after the complete corpus pass.
- Quality gate commands: JSON parser, citation/path checker, census reconciliation, `git status --short`, `git diff --stat`, `git diff --name-only`, and `git diff --check`.

### Automation A3.0 JSONB evidence and decision

- Classification: `ACTIVE WRITE DEFECT`.
- PostgreSQL 16.14 reproduction against the unmodified `132ff1f` source proved that current Drizzle object writes persisted both `automation_versions.config` and `automation_executions.evidence` with `jsonb_typeof = string`; SQL key access returned null. A direct postgres-js control proved `client.json(object)` persists `jsonb_typeof = object`, while the existing mapped write double-serializes.
- Scope is confined to the Automation JSONB adapter boundary. No production database was queried. No consent, identity, provider, outbox, notification, checkout, payment, fulfilment, Customer DNA, NBA, Decision Intelligence, RBAC, audit, route, UI, Registry, schema, or migration behavior changed.
- Migration decision: `NONE`. Fresh migration replay through immutable migrations `0000`-`0039` passed. A new migration is not justified because the adapter can write native JSONB and safely read exactly one historical string layer without bulk data rewriting.
- The bounded infrastructure codec writes objects/arrays through the postgres-js JSON parameter wrapper, reads native containers, decodes exactly one legacy layer, rejects malformed/two-layer/scalar data, validates stored Automation configuration, and centralizes the SQL read expression used for trigger matching.
- The planning repository now writes execution evidence through that codec and no longer performs scattered `JSON.parse`. The real-PostgreSQL proof writes version config/evidence objects and array evidence natively, checks SQL key access, proves one-layer legacy semantic equality, proves malformed fail-closed behavior, retains planner concurrency/idempotency and ineligibility assertions, and reports zero provider calls.

### A3.0 verification

- Focused A1/A2/A3.0 tests: 3 files, 23 tests passed.
- Real PostgreSQL proof: `versionJsonbType=object`, `evidenceJsonbType=object`, `arrayJsonbType=array`, SQL trigger/outcome access succeeded, `legacyJsonbType=string`, `legacySemanticMatch=true`, `malformedRejected=true`, one planned plus one duplicate under the race, repeat duplicate detected, ineligible/no-profile paths retained, `providerCalls=0`, `verdict=PASS`.
- Fresh migration replay: migrations `0000`-`0039` passed in an isolated PostgreSQL 16.14 scratch database; no migration files changed.
- API and workspace typecheck: passed. Architecture suite: 2 files / 10 tests passed. Workspace build: API and Astro web passed. Secret scan: 1,095 source/config files passed without values printed. `git diff --check`: passed.
- Full suite while dirty: 178 files / 3,959 tests passed; 9 files / 12 tests failed only because historical slice artifact tests inspect the whole Git dirty-path set and reject the declared A3.0 paths. No behavioral assertion failed. These exact dirty-tree guards must be rerun from the clean A3.0 commit.
- API lint: all A3.0 paths had zero errors. The command retained the repository baseline failure at `apps/api/src/application/ports/ICustomerDnaRepository.ts:6` (`no-empty-object-type`), with 718 established warnings; no unrelated lint cleanup was made.

### C0 generated artifacts and validation duties

- `CODEX_CODEBASE_CENSUS.json` — complete tracked census.
- `CODEX_ARCHITECTURE_MAP.md` — workspace/runtime/layer/persistence/worker/security map.
- `CODEX_CONVENTIONS_AND_STYLE.md` — repository-derived conventions with at least three representative files or symbols where available.
- `CODEX_MODULE_AND_FEATURE_MAP.md` — major module purpose/status/layers/invariants/residuals.
- `CODEX_EXECUTION_PATHS.md` — six required end-to-end paths with transactions, audit, outbox, failure, idempotency, tests and proofs.
- `CODEX_DEPENDENCY_AND_CHANGE_IMPACT.json` — important tracked implementation/configuration/test/release paths with imports, reverse imports, symbols, module, impact, protection, and reasons.
- This ledger.

Before C0 commit: parse both generated JSON documents; verify every cited repository path exists; reconcile census totals; run `git diff --check`; review that the change set is documentation only. Commit subject: `Docs: add Codex whole-codebase orientation`. Push and prove local HEAD equals origin with a clean tree.

## A3.0 readiness boundary (completed)

The readiness gate was issued after the C0 commit/push and before source editing. It reported the complete census, architecture and conventions, protected assets, current Automation architecture, PostgreSQL defect evidence, `ACTIVE WRITE DEFECT` classification, exact expected/not-expected paths, impact, unknowns, no-migration decision, focused tests, real-PostgreSQL proof, full gates, and proposed commit.

Expected files if the evidence proves a bounded active write/read defect:

- `goldplus-commerce/apps/api/src/infrastructure/db/repositories/DrizzleAutomationRepositories.ts`
- a narrowly scoped Automation JSONB codec under `goldplus-commerce/apps/api/src/infrastructure/db` only if one boundary is clearer than inline helpers
- `goldplus-commerce/tests/unit/AutomationA2Planning.test.ts` or a new focused Automation JSONB unit test
- `goldplus-commerce/apps/api/src/scripts/automation-planning-proof.ts` or a new focused real-PostgreSQL proof
- orientation/continuation evidence documents after proof

Files not expected to change in A3.0: domain Automation policy, A1/A2 port shapes unless proven necessary, Registry, routes/UI, consent, Customer DNA/NBA, Decision Intelligence, fulfilment, inventory, outbox, NotificationRouter/providers, authentication/RBAC, deployment files, and migrations `0000`-`0039`.

Migration decision: `NO MIGRATION EXPECTED` until the database evidence proves stored legacy rows require an additive normalization operation that cannot safely remain read-compatible. If and only if proven necessary, use additive `0040`; never rewrite prior migrations or perform a platform-wide JSONB rewrite.

Focused proof target: native JSONB object writes, compatibility reads for any legacy string rows, SQL key filtering for both shapes, planner concurrency/idempotency, preserved provider-zero behavior. Full gates: focused units, architecture, full tests, typecheck, lint, build, migration integrity/rehearsal as applicable, `git diff --check`, and real PostgreSQL proof.

## Slice history

| Slice | Base | Change boundary | Proof | Commit/push | Next |
|---|---|---|---|---|---|
| C0 | `bfb0ffc3d004f8eecc039722f540eef75d8d7193` | Exactly seven orientation artifacts plus factual continuation state | 1,690/1,690 classified; 1,620/1,620 text inspected; zero unclassified; JSON/path/hash reconciliation and diff check passed | `132ff1fc04977acd87e5d5c9f0702603786267f7`, pushed and clean/aligned | A3.0 readiness and PostgreSQL reproduction |
| A3.0 | `132ff1fc04977acd87e5d5c9f0702603786267f7` | Automation JSONB infrastructure codec, repository write/read boundary, focused unit and real-PG proof, factual state evidence | ACTIVE WRITE DEFECT reproduced; native object/array, bounded legacy, malformed rejection, SQL access, concurrency/idempotency, migration replay, typecheck/architecture/build/secret scan passed; clean suite 187 files / 3,971 tests passed | `a44f456bc69d6d6fa0c834ff51f7d13f85d4c9de`, pushed and clean/aligned | A3.1 |
| A3.1 | `a44f456bc69d6d6fa0c834ff51f7d13f85d4c9de` | Fixed pure gate order and suppression enum; eligibility/cap port and use case; Automation-only reservation schema/migration/Drizzle adapter; focused and PG proofs; factual state evidence | 44 focused tests; fresh `0000`-`0040` and populated `0039`→`0040` upgrade; two racers → one slot/one exact suppression; winner retry reused slot; clean suite 188 files / 3,992 tests passed; provider calls zero | `74b05db5db7294eafa39d63f7297229372373d74`, pushed and clean/aligned | A3.2 |
| A3.2 | `74b05db5db7294eafa39d63f7297229372373d74` | Automation action port/use case, Drizzle atomic cap/outbox adapter, native fulfilment bridge, Registry wiring, unit/PG proof, factual evidence | 50 Automation tests; two executors → one QUEUED action/one cap/one linked native-JSONB no-send outbox intent; internal duplicate one effect; typecheck, architecture, build, secret scan, lint/diff passed; clean suite 189 files / 3,998 tests passed; provider calls zero | `6a0f924ca97568b14d8536eb6ae793afbefd2917`, pushed and clean/aligned | A3.3 |
| A3.3 | `6a0f924ca97568b14d8536eb6ae793afbefd2917` | Truthful provider outcome wrapper at the existing router, action outcome/DLQ/reconciliation repository operations, gate-revalidated replay through the existing outbox, focused unit/PG proof, factual evidence | Ambiguous attempts become non-replayable OUTCOME_UNKNOWN; explicit evidence reconciles; eighth known failure dead-letters; replay re-evaluates gates and reuses one cap; successful/internal/unknown actions are non-replayable; clean suite 190 files / 4,011 tests; fake adapter 10 calls, network calls zero | `2b88fd906a708d47eaa57d070e912cdd19d8d6f1`, pushed and clean/aligned | A3.4 |
| A3.4 | `2b88fd906a708d47eaa57d070e912cdd19d8d6f1` | Real-PG execution proof; proof-found bounded existing-outbox/provider-attempt lease correction; reconciliation evidence strengthening; focused regressions and factual state | 13 prohibited states zero calls; one outbox owner/active attempt/provider effect; truthful QUEUED/PROCESSING/SENT/FAILED/UNKNOWN/DLQ; evidence reconciliation; cap-preserving replay; crash ambiguity; zero orphans/duplicates/residue | `ebccac4b88d2a9b4dee4c5b5a54ebbbe89f19d34`, pushed and clean/aligned; clean suite 190 files / 4,015 tests | A4 |
| A4 | `ebccac4b88d2a9b4dee4c5b5a54ebbbe89f19d34` | Exact Automation RBAC; operations port/use case/Drizzle adapter; protected Hono/Zod API; shared audit; persistence aggregates; real Astro definition/execution UI; PG/API proof | Protected lifecycle, immutability/stale conflict, approval/rejection, pause/resume, zero-call dry run, evidence reads, ambiguous replay guard/reconciliation, audit/correlation, zero residue; focused+architecture 71/71; typecheck/build/secret/lint/diff pass; clean suite 191 files / 4,020 tests | Commit subject: `Module Automation A4: add automation operations control room`; push pending | Push/alignment, then A5 |

## A3.1 — deterministic eligibility and transactional frequency caps

- Verified base: clean local/origin `a44f456bc69d6d6fa0c834ff51f7d13f85d4c9de`; ledger and `CODEX_A3_WORK_PLAN.json` reread before edits.
- Gate order is fixed and fail-closed: definition pause → approval → subject → profile/data → identity conflict → freshness → consent → audience → conditions → frequency reservation. The full current exact reason enum is persisted through `automation_suppressions`; generic suppression without a reason is rejected.
- Migration decision: `0040 REQUIRED`. Existing executions are plans and cannot distinguish durable cap ownership from DRY_RUN, DISABLED, NOT_CONFIGURED, or SUPPRESSED. Existing suppressions represent rejection, not a reusable positive slot. Reusing either would violate no-slot and retry/replay invariants. The additive `automation_frequency_cap_reservations` table gives each execution at most one durable slot and indexes the exact version/scope/window bucket. Migrations `0000`-`0039` remain byte-unchanged.
- Concurrency boundary: the Drizzle adapter takes a PostgreSQL transaction-scoped advisory lock for the exact version/scope/window, then performs existing-slot check, count, and insert in one transaction. Repeated calls for the winning execution reuse its row. A capped contender records one idempotent `FREQUENCY_CAPPED` suppression in the same transaction.
- No-slot semantics: DRY_RUN, DISABLED, NOT_CONFIGURED, and SUPPRESSED never invoke cap reservation. SUPPRESSED requires and persists an exact reason. Non-provider gate failure persists its exact reason before returning.
- Focused proof: `AutomationA1Domain`, `AutomationA2Planning`, `AutomationJsonbCodec`, and `AutomationA31Eligibility` passed 44/44. All eleven suppression reasons are asserted; invalid zero/negative cap/window configuration fails closed.
- PostgreSQL 16.14 proof: fresh replay through `0040` passed; populated `0039`→`0040` upgrade changed table presence from zero to one and passed. Concurrent proof returned `racersReserved=1`, `racersFrequencyCapped=1`, `reservationRows=1`, `exactSuppressionRows=1`, `retryReusedOriginalSlot=true`, `providerCalls=0`, `verdict=PASS`.
- Other gates: workspace/API typecheck passed; architecture 10/10 passed; API/web build passed; secret scan passed 1,100 files without printing values; focused changed-path lint passed with zero errors; `git diff --check` passed. The clean-tree full suite is required immediately after the slice commit because historical artifact tests intentionally reject any dirty path set.
- Protected boundaries unchanged: Registry, routes/UI, workers, shared outbox/ticker/processor, NotificationRouter/provider adapters, consent engine, Customer DNA/NBA internals, Decision Intelligence, fulfilment, inventory, RBAC/audit infrastructure, and production/release controls.
- A3.2 handoff: combine cap reservation and exactly one existing-outbox intent in one transaction for external actions; execute internal actions through existing native use cases; do not create another outbox, router, scheduler, or provider path.

## A3.2 — internal effects and atomic existing-outbox intents

- Verified base: clean local/origin `74b05db5db7294eafa39d63f7297229372373d74`; ledger and A3.2 work-plan entry reread before edits.
- Migration decision: `NONE`. A3.1's reservation table, the existing `automation_action_executions.outbox_event_id`, and existing `outbox_events` provide the full persistence contract. Migration `0040` and all earlier migrations remain unchanged.
- External EMAIL/WHATSAPP_TEMPLATE execution takes a row lock on the existing action execution and, in one database transaction, creates/reuses the cap reservation, inserts exactly one idempotent `AUTOMATION_ACTION_REQUESTED` row in the existing outbox, links its ID, and changes the action from PLANNED to QUEUED. `QUEUED` is explicitly an intent, not a send or success.
- The outbox payload is native JSONB through the bounded Automation codec. New intents are `dry_run_only=true` and `no_send_guarantee=true`; the action use case has no router/provider dependency and reports `providerCalls=0`.
- Internal execution is behind one application port. Registry's bounded production adapter reuses `CreateFulfilmentTaskOnOrderPlacedUseCase` for a real configured `CREATE_FULFILMENT_TASK`; that native path is idempotent on order. Families without a safe existing idempotent native use case fail closed as NOT_CONFIGURED with no cap. No generic admin/support task system was invented.
- Internal claims reuse the existing parent execution lease fields. Concurrent calls return BUSY while a lease is active; an expired PROCESSING lease is reclaimable. Completion records INTERNAL_SUCCESS and clears the lease. This preserves a crash-recovery boundary without another worker framework or schema change.
- Focused proof: five Automation files / 50 tests passed, including one internal effect under duplicates, truthful IN_PROGRESS, native fulfilment delegation/replay, exact suppression, fail-closed unsupported internals, one external logical intent, and zero direct cap reservation outside the atomic external adapter.
- PostgreSQL 16.14 proof: `executorWinner=1`, `executorDuplicate=1`, `actionRows=1`, `actionStatus=QUEUED`, `outboxIntentRows=1`, `capReservationRows=1`, `actionQueuedEvents=1`, `outboxLinked=true`, `nativePayload=true`, `noSendGuarantee=true`, `providerCalls=0`, `verdict=PASS`. The A3.1 two-cap-racer proof also passed unchanged after extracting the shared transaction helper.
- Other gates: workspace/API typecheck passed; architecture 10/10 passed; API/web build passed; secret scan passed 1,106 files without printing values; focused changed-path lint passed with zero errors; `git diff --check` passed. Clean-tree full suite is required immediately after commit.
- Protected assets unchanged: `ProcessOutboxBatchUseCase`, `DrizzleOutboxRepository`, `NotificationRouter`, all provider adapters, existing retry/ticker/worker implementation, consent, Customer DNA/NBA, Decision Intelligence, fulfilment internals, routes/UI, and migrations.
- A3.3 handoff: add truthful provider outcome mapping/reconciliation/replay around the existing outbox/router/ticker. Never equate QUEUED with SENT; never blindly retry OUTCOME_UNKNOWN; replay must re-evaluate gates and reuse the original cap slot.

## A3.3 — provider outcomes, dead-lettering, reconciliation, and replay

- Verified base: clean local/origin `6a0f924ca97568b14d8536eb6ae793afbefd2917`; ledger and A3.3 work-plan entry reread before edits.
- Migration decision: `NONE`. Existing action status/attempt/error fields, automation events, cap reservations, and the existing outbox retry/dead-letter/requeue contract provide the required durable state. Migration `0040` and all earlier migrations remain unchanged.
- `AutomationOutcomeTrackingProvider` is selected only for `AUTOMATION_ACTION_REQUESTED` by the existing `NotificationRouter`. It reports SENT only after an explicit adapter success; known attempted failures are FAILED; thrown or ambiguous adapter outcomes are OUTCOME_UNKNOWN; dry-run, disabled, and not-configured results are zero-attempt terminal outcomes. The persisted no-send guarantee prevents delegate invocation.
- Provider attempts are counted only after their durable claim, dead-letter the eighth known failure, release a cap only for zero-attempt outcomes, and retain the original cap for live failures, dead letters, unknown outcomes, and replay. OUTCOME_UNKNOWN cannot enter the replay path and requires explicit actor, reason, and independent evidence/reference to reconcile to SENT or FAILED.
- Replay accepts only FAILED or DEAD_LETTERED actions, reloads the current immutable version/definition/approval, re-evaluates the complete A3.1 gate chain, reuses the original cap reservation, and delegates requeueing to the existing outbox repository. SENT, INTERNAL_SUCCESS, and OUTCOME_UNKNOWN fail closed as non-replayable.
- Focused proof: the seven Automation A1–A3.3/outbox files passed 72/72; the A3.3-specific three files passed 28/28. Coverage includes zero-call no-send, explicit success, ambiguous outcome, dry-run truthfulness, eighth-failure DLQ, full-gate replay, stale suppression, cap reuse, terminal non-replayability, and evidence-required reconciliation.
- PostgreSQL 16.14 proof: `ambiguousStatus=OUTCOME_UNKNOWN`, `ambiguousReplayable=false`, `ambiguousReconciledStatus=SENT`, `deadLetterStatus=DEAD_LETTERED`, `deadLetterAttempts=8`, `capRowsBeforeReplay=1`, `replaySucceeded=true`, `replayReusedCap=true`, `sentStatus=SENT`, `sentReplayBlocked=true`, `fakeAdapterCalls=10`, `networkCalls=0`, `verdict=PASS`.
- Other gates: workspace/API typecheck passed; architecture 10/10 passed; API/web build passed; secret scan passed 1,111 files without printing values; focused changed-path lint passed with zero errors; `git diff --check` passed. Repository-wide lint retains its pre-existing single `ICustomerDnaRepository.ts:6` error and 725 warnings outside the A3.3 boundary. The clean-tree full suite is required immediately after commit.
- Protected boundaries unchanged: provider adapters, `ProcessOutboxBatchUseCase`, outbox ticker/worker implementation, consent, Customer DNA/NBA, Decision Intelligence, fulfilment internals, routes/UI, authentication/RBAC/audit, and migrations.
- A3.4 handoff: add explicit zero-network mode counters and combined crash/concurrency/orphan proofs without adding a worker, router, scheduler, outbox, or provider path.

## A3.4 — zero-network, concurrency, and crash-window proofs

- Verified base: clean local/origin `2b88fd906a708d47eaa57d070e912cdd19d8d6f1`; ledger and A3.4 work-plan entry reread before proof edits.
- Initial boundary: `apps/api/src/scripts/automation-execution-proof.ts` plus factual continuation/checklist documentation only. The expanded proof demonstrated the implementation defect below, authorizing only its smallest production correction and focused regression tests. Migration decision remains `NONE`: existing outbox status/next-attempt fields and Automation execution lease fields can represent the fix.

### PROOF-FOUND IMPLEMENTATION DEFECT

- Failure: two concurrent delivery workers claimed the same existing-outbox intent; a duplicate delivery invoked the controlled provider twice, with the action still QUEUED during the first call and already SENT during the second.
- Reproduction: PostgreSQL 16.14 A3.4 proof returned `deliveryWorkerClaims=2`, `duplicateEffectCalls=2`, `statusesDuringProviderCall=["QUEUED","SENT"]`, and `verdict=FAIL`.
- Affected invariant: one active provider attempt at a time; duplicate retry creates no duplicate business effect; provider-call crash windows become explicit ambiguity rather than a blind resend.
- Smallest source change: make existing-outbox claiming a transactional durable lease using existing fields, and claim an Automation provider attempt using the action's existing indexed `next_retry_at` timestamp before transport. An expired PROCESSING attempt becomes OUTCOME_UNKNOWN and terminal until reconciliation.
- Files: `DrizzleOutboxRepository.ts`, `IAutomationActionRepository.ts`, `DrizzleAutomationActionRepository.ts`, `AutomationOutcomeTrackingProvider.ts`, and focused existing/new Automation/outbox tests; no schema, migration, new worker, router, outbox, or provider adapter.
- Impact: HIGH but bounded to existing outbox claim concurrency and Automation provider-attempt state; other event routing and provider adapters remain unchanged.
- Focused regression test: concurrent outbox claims yield one owner; duplicate Automation dispatch yields one provider call; in-flight status is PROCESSING; expired attempt becomes non-replayable OUTCOME_UNKNOWN without transport.
- Rollback: revert the A3.4 commit; no data migration or schema rollback is required.
- Correction proof: existing-outbox `claimDueBatch` now selects and durably leases inside one transaction using the existing status/next-attempt fields; concurrent workers return one owner. Automation claims a provider attempt with its existing indexed action `next_retry_at` field before transport, exposes PROCESSING, blocks duplicate effects after terminal success, and converts an expired in-flight attempt to non-replayable OUTCOME_UNKNOWN. No schema/migration, second worker, outbox, router, or provider adapter was added.
- The proof uses the real A3.1–A3.3 application and Drizzle repository paths against PostgreSQL 16.14. Per-state transport spies prove `DRY_RUN`, `PROVIDER_DISABLED`, `PROVIDER_NOT_CONFIGURED`, `CUSTOMER_COMMUNICATIONS_DISABLED`, `NOTIFICATION_DELIVERY_DISABLED`, `LIVE_SEND_DISABLED`, `SUPPRESSED`, `NO_CONSENT`, `CHANNEL_OPT_OUT`, `IDENTITY_CONFLICT`, `FREQUENCY_CAPPED`, `AUTOMATION_PAUSED`, and `GLOBAL_PAUSE` each invoke the adapter zero times. Outcomes persist truthfully as DRY_RUN, DISABLED, NOT_CONFIGURED, or SUPPRESSED—never SENT.
- Internal effects remain independent of provider delivery: the configured internal proof executor completes both an ordinary internal action and an expired-PROCESSING-lease recovery, recording two effects. The recovered action has one attempt and releases the execution lease.
- Delivery truth proof: QUEUED precedes transport; PROCESSING is observed during the one positive fake-provider call; SENT has a matching positive provider-code event; FAILED follows one claimed/real call; OUTCOME_UNKNOWN follows one ambiguous call; known failure attempt eight becomes DEAD_LETTERED. SENT, INTERNAL_SUCCESS, and unresolved OUTCOME_UNKNOWN are non-replayable.
- Reconciliation/replay proof: actor, reason, and independent evidence are required and persisted; reconciling UNKNOWN to FAILED makes no automatic call; operator replay re-evaluates current A3.1 gates, reuses exactly one existing cap row, uses the existing outbox, and becomes SENT only after one positive fake-provider result.
- Crash proof: a claimed PROCESSING attempt represents the active lineage. A controlled provider acceptance followed by loss of local finalization leaves an expired lease; recovery records OUTCOME_UNKNOWN and does not call the provider again. The proof makes no exactly-once external-delivery claim.
- Concurrency/integrity proof: two action creators yield one winner/one duplicate, one action/cap/outbox; two delivery workers yield one outbox owner; duplicate dispatch yields one provider effect. `orphanActions`, `orphanOutboxLinks`, `orphanEvents`, `orphanReservations`, `missingEvidence`, duplicate trigger/action/active-attempt counts, and post-cleanup proof residue are all zero.
- Proof correctness: API/workspace types compile; success exits zero; failures throw and set a non-zero exit code; cleanup runs for all proof IDs; `endDbConnection()` closes PostgreSQL handles before the single final JSON verdict; no hanging process remains.
- Gates: seven focused Automation/outbox files pass 76/76; workspace typecheck, architecture 10/10, API/web build, secret scan (1,112 files), changed-path lint with zero errors, and `git diff --check` pass. Repository-wide lint remains `PRE-EXISTING UNRELATED BASELINE ERROR` at `ICustomerDnaRepository.ts:6`; A3.4 adds no lint error. Clean-tree full suite remains required immediately after commit.
- PostgreSQL final verdict includes all 13 zero counters, `deliveryWorkerClaims=1`, `duplicateEffectCalls=1`, `statusesDuringProviderCall=["PROCESSING"]`, evidence-backed reconciliation, `replayReusedCap=true`, cap rows `1→1`, `deadLetterAttempts=8`, crash `PROCESSING→OUTCOME_UNKNOWN` with one original call/no resend, every orphan/duplicate count zero, `proofResidue=0`, and `verdict=PASS`.
- Completion state: Automation is `SOURCE_PARTIAL`; A1–A3.4 are present, while the required A4 protected operating surface and A5 end-to-end acceptance remain.
- A4 handoff: build the Automation control room by extending the existing Hono admin composition, RBAC permission model, audit path, metrics system, and Astro admin shell. Preserve the proven executor/outbox/provider boundaries.

## A4 — protected Automation operations control room

- Verified base: clean local/origin A3.4 commit `ebccac4b88d2a9b4dee4c5b5a54ebbbe89f19d34`; ledger/current-state/next-worktree reread before edits.
- Review gate selected the native admin Hono/auth/permission/ApiResponse/Zod, Registry, shared audit, Drizzle transaction,
  Automation JSONB codec and server-rendered Astro patterns. None of the existing general permissions was precise enough,
  so all seven exact Automation permissions were added; reconciliation is independent of read/execute.
- Migration decision: `NONE`. Existing `0039` and `0040`, shared audit, outbox and notification-attempt assets cover A4.
- The operations adapter owns transactional definition/version/approval transitions and real aggregate/detail reads. The use
  case validates immutable config, delegates controlled execution/replay/reconciliation to A3, and writes shared audit.
- API routes never call a provider. Dry-run persists zero-attempt evidence. External manual execution creates only an
  existing-outbox intent. Reconciliation accepts only a bounded evidence reference, not raw secrets/PII.
- PostgreSQL/Hono proof passed draft/version/submit/approve/reject/activate/pause/resume, stale conflict, zero-call dry run,
  suppression/attempt evidence, ambiguous replay denial, separate evidence-backed reconciliation, audit/correlation and
  aggregate reads. Result: provider calls zero and proof residue zero.
- Focused Automation plus architecture: 71/71. Workspace typecheck/build, API/Astro production build, secret scan,
  changed-path lint with zero errors, and diff check pass. Repository lint retains only the unrelated baseline error at
  `ICustomerDnaRepository.ts:6`. Chromium desktop rendered the built Astro control room from a real scratch PostgreSQL/API
  definition and cleaned its definition/audit/RBAC/user fixture.
- Status remains `SOURCE_PARTIAL` only because A5 acceptance is not yet complete. No deployment or `LIVE_VERIFIED` claim.
- A5 handoff: exercise the complete lifecycle through production-shaped API/web and real PostgreSQL with the controlled
  fake provider/call counter, all concurrency/crash/ambiguity/replay/pause-resume assertions, migration rehearsals and full gates.
