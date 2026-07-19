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

### Current Automation JSONB evidence (source only; PostgreSQL reproduction pending)

- `goldplus-commerce/apps/api/src/infrastructure/db/schema/automation.ts` declares `automation_versions.config` and `automation_executions.evidence` as `jsonb`.
- `DrizzleAutomationRepository.findActiveApprovedByTrigger` uses a SQL `CASE` that accepts `jsonb_typeof(config) = 'string'` and native objects, then performs another `typeof r.config === 'string' ? JSON.parse(...)` compatibility read.
- `DrizzleAutomationExecutionRepository.persistPlan` passes `input.evidence as object` to Drizzle without a local codec.
- `apps/api/src/scripts/automation-planning-proof.ts` inserts a JavaScript configuration object and asserts planning, evidence, and idempotency, but does not assert PostgreSQL `jsonb_typeof`.
- This is evidence of an active compatibility workaround and an untested write contract. It is not yet sufficient to select NO ACTIVE DEFECT, LEGACY DATA ONLY, or ACTIVE WRITE DEFECT. That decision is blocked on a real PostgreSQL reproduction after the C0 documentation commit.

### C0 generated artifacts and validation duties

- `CODEX_CODEBASE_CENSUS.json` — complete tracked census.
- `CODEX_ARCHITECTURE_MAP.md` — workspace/runtime/layer/persistence/worker/security map.
- `CODEX_CONVENTIONS_AND_STYLE.md` — repository-derived conventions with at least three representative files or symbols where available.
- `CODEX_MODULE_AND_FEATURE_MAP.md` — major module purpose/status/layers/invariants/residuals.
- `CODEX_EXECUTION_PATHS.md` — six required end-to-end paths with transactions, audit, outbox, failure, idempotency, tests and proofs.
- `CODEX_DEPENDENCY_AND_CHANGE_IMPACT.json` — important tracked implementation/configuration/test/release paths with imports, reverse imports, symbols, module, impact, protection, and reasons.
- This ledger.

Before C0 commit: parse both generated JSON documents; verify every cited repository path exists; reconcile census totals; run `git diff --check`; review that the change set is documentation only. Commit subject: `Docs: add Codex whole-codebase orientation`. Push and prove local HEAD equals origin with a clean tree.

## A3.0 readiness boundary (declared, not yet authorized for editing)

Read this ledger and re-verify HEAD after C0. Then reproduce the JSONB condition in non-production PostgreSQL using the current write/read path. The readiness gate must report the actual `jsonb_typeof`, query behavior, decoded application value, whether newly inserted Automation rows are affected, and whether any legacy data needs compatibility reads.

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
| C0 | `bfb0ffc3d004f8eecc039722f540eef75d8d7193` | Documentation only | Census/JSON/path/diff reconciliation pending final run | Commit subject reserved: `Docs: add Codex whole-codebase orientation` | C0 commit/push, then real-PG JSONB readiness gate |
